import os
import pika
import time
import json
import psycopg
import psycopg.rows
import requests
from typing import Any, Callable, Dict, Optional
from openai import OpenAI
from neo4j import GraphDatabase

# ----------------------------------------------------------------------------
# Database Utilities
# ----------------------------------------------------------------------------

def _get_db_connection() -> psycopg.Connection:
    """Create a new PostgreSQL connection using environment variables."""
    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        dbname=os.environ.get("POSTGRES_DB", "celion"),
        user=os.environ.get("POSTGRES_USER", "celion"),
        password=os.environ.get("POSTGRES_PASSWORD", "celion"),
        row_factory=psycopg.rows.dict_row,
    )

def _write_chat_message(conn: psycopg.Connection, migration_id: str, role: str, content: str, step_number: Optional[int] = None):
    """Writes a message to the migration_chat_messages table."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.migration_chat_messages (migration_id, role, content, step_number)
            VALUES (%s, %s, %s, %s)
            """,
            (migration_id, role, content, step_number),
        )
        conn.commit()

def _write_action_buttons(conn: psycopg.Connection, migration_id: str, step_number: int, next_step_title: Optional[str] = None):
    """Writes action buttons (Continue/Retry) to the chat."""
    actions = []
    if next_step_title:
        actions.append({
            "action": "continue",
            "label": f"Weiter zu Schritt {step_number + 1} {next_step_title}",
            "variant": "primary"
        })
    
    actions.append({
        "action": "retry",
        "label": f"Schritt {step_number} wiederholen",
        "variant": "outline",
        "stepNumber": step_number
    })

    action_content = json.dumps({
        "type": "action",
        "actions": actions
    })
    _write_chat_message(conn, migration_id, 'system', action_content, step_number)

def _update_migration_step_status(conn: psycopg.Connection, migration_id: str, step_number: int, status: str, message: Optional[str] = None):
    """Updates the status of a migration and its current step."""
    
    # Determine the overall migration status based on step_status
    overall_migration_status: str
    progress: float = (step_number / 10.0) * 100.0
    
    if status == 'completed':
        # Only set overall status to completed if it was the last step (10)
        if step_number >= 10:
            overall_migration_status = 'completed'
            progress = 100.0
        else:
            overall_migration_status = 'processing'
        
        # KPI: Increment global steps and agent metrics
        _increment_global_stats(conn, steps=1, success=1, total_agents=1)

    elif status == 'failed':
        overall_migration_status = 'paused'
        # KPI: Record a failed attempt
        _increment_global_stats(conn, total_agents=1)
    else: # 'running', 'pending', 'idle'
        overall_migration_status = 'processing'
        # If running, we might be at slightly less than full step progress
        progress = max(0, ((step_number - 0.5) / 10.0) * 100.0)

    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE public.migrations
            SET current_step = %s, step_status = %s, status = %s, progress = %s
            WHERE id = %s
            """,
            (step_number, status, overall_migration_status, progress, migration_id),
        )
        conn.commit()

def _increment_global_stats(conn, steps=0, objects=0, success=0, total_agents=0, accuracy=None):
    """Helper to update the daily global statistics."""
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO public.global_stats 
                (day, steps_completed, objects_migrated, agent_success_count, agent_total_count, reconciliation_accuracy_sum, reconciliation_count)
                VALUES (CURRENT_DATE, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (day) DO UPDATE SET
                    steps_completed = global_stats.steps_completed + EXCLUDED.steps_completed,
                    objects_migrated = global_stats.objects_migrated + EXCLUDED.objects_migrated,
                    agent_success_count = global_stats.agent_success_count + EXCLUDED.agent_success_count,
                    agent_total_count = global_stats.agent_total_count + EXCLUDED.agent_total_count,
                    reconciliation_accuracy_sum = global_stats.reconciliation_accuracy_sum + EXCLUDED.reconciliation_accuracy_sum,
                    reconciliation_count = global_stats.reconciliation_count + EXCLUDED.reconciliation_count
            """, (steps, objects, success, total_agents, float(accuracy) if accuracy is not None else 0.0, 1 if accuracy is not None else 0))
            conn.commit()
    except Exception as e:
        print(f"Failed to update global stats: {e}")

def _update_workflow_state(conn: psycopg.Connection, migration_id: str, workflow_state: Dict[str, Any]):
    """Updates the workflow_state of a migration."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE public.migrations SET workflow_state = %s WHERE id = %s",
            (json.dumps(workflow_state), migration_id),
        )
        conn.commit()

def _get_connector(conn: psycopg.Connection, migration_id: str, connector_type: str = 'in'):
    """Fetches connector details for a migration."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT api_url, api_key, username, password, auth_type FROM public.connectors WHERE migration_id = %s AND connector_type = %s",
            (migration_id, connector_type),
        )
        return cur.fetchone()

def _get_neo4j_driver():
    """Create a new Neo4j driver using environment variables."""
    uri = os.environ.get("NEO4J_URI", "bolt://neo4j-db:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD", "password")
    return GraphDatabase.driver(uri, auth=(user, password))

def _load_system_scheme(system_name: str):
    """Loads a system scheme from the schemes directory."""
    normalized = system_name.lower().replace(' ', '').replace('-', '')
    # Check common variations
    variations = [normalized, normalized.replace('cloud', ''), normalized.replace('server', '')]
    
    scheme_path = None
    for var in variations:
        path = f"/app/schemes/{var}.json"
        if os.path.exists(path):
            scheme_path = path
            break
        path = f"schemes/{var}.json"
        if os.path.exists(path):
            scheme_path = path
            break
            
    if not scheme_path:
        return None
        
    try:
        with open(scheme_path, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading scheme {system_name}: {e}")
        return None

def _extract_items(body: Any, entity_name: str) -> list:
    """Extracts a list of items from a response body."""
    if isinstance(body, list): return body
    if isinstance(body, dict):
        # Try common keys
        for key in [entity_name, 'items', 'data', 'tasks', 'results', 'values', 'elements']:
            if key in body and isinstance(body[key], list):
                return body[key]
        # Search for any list
        for key, value in body.items():
            if isinstance(value, list):
                return value
    return []

def _ingest_items_to_neo4j(driver, system_label, entity_name, items, migration_id):
    """Ingests a batch of items into Neo4j."""
    if not items:
        return
        
    sanitized_items = []
    for item in items:
        sanitized = {}
        # Ensure we have an ID
        if not item.get('id'): continue
        
        for k, v in item.items():
            if isinstance(v, (str, int, float, bool)) or v is None:
                sanitized[k] = v
        sanitized_items.append(sanitized)
    
    if not sanitized_items:
        return

    with driver.session() as session:
        # We use external_id and migration_id as unique constraint
        # Label is the system name (e.g. ClickUp)
        query = (
            f"UNWIND $items AS item "
            f"MERGE (n:`{system_label}` {{ external_id: toString(item.id), migration_id: $migration_id }}) "
            f"SET n.entity_type = $entity_type "
            f"SET n += item"
        )
        session.run(
            query,
            items=sanitized_items, 
            migration_id=str(migration_id), 
            entity_type=entity_name
        )

def _run_reconciliation(conn: psycopg.Connection, migration_id: str, source_system: str):
    """Phase 4: Reconciliation & Abschluss (Validierung)"""
    _write_chat_message(conn, migration_id, 'system', 'Phase 4: Reconciliation starting...', 5)
    
    # 1. Get expected count from Step 3 (Source Discovery)
    with conn.cursor() as cur:
        cur.execute("SELECT SUM(count) as total FROM public.step_3_results WHERE migration_id = %s", (migration_id,))
        row = cur.fetchone()
        expected_count = int(row['total']) if row and row['total'] else 0
        
    # 2. Get actual count from Neo4j
    actual_count = 0
    driver = None
    try:
        driver = _get_neo4j_driver()
        with driver.session() as session:
            result = session.run(
                f"MATCH (n:`{source_system}`) WHERE n.migration_id = $migration_id RETURN count(n) as total",
                migration_id=str(migration_id)
            )
            record = result.single()
            actual_count = record["total"] if record else 0
    except Exception as e:
        _write_chat_message(conn, migration_id, 'system', f"Failed to perform reconciliation count: {e}", 5)
        raise e
    finally:
        if driver:
            driver.close()
            
    # 3. Abgleich
    _write_chat_message(conn, migration_id, 'system', f"Reconciliation: Expected {expected_count} objects, found {actual_count} in Neo4j.", 5)
    
    # KPI: Update global stats with actual migrated count and accuracy
    accuracy = 1.0
    if expected_count > 0:
        accuracy = max(0.0, 1.0 - (abs(expected_count - actual_count) / float(expected_count)))
    
    _increment_global_stats(conn, objects=actual_count, accuracy=accuracy)

    if expected_count > 0 and actual_count == 0:
        error_msg = "Critical error: No objects were imported into Neo4j."
        _write_chat_message(conn, migration_id, 'system', f"⚠️ {error_msg}", 5)
        raise Exception(error_msg)
        
    diff = abs(expected_count - actual_count)
    if expected_count > 0 and (diff / expected_count) > 0.1: # More than 10% difference
        warning_msg = f"Warning: Large discrepancy detected ({diff} objects difference). Please check source system logs."
        _write_chat_message(conn, migration_id, 'system', f"⚠️ {warning_msg}", 5)
        # We don't raise here to allow the user to proceed if they want, but the warning is clear.

    return actual_count

def _run_graph_enhancement(conn: psycopg.Connection, migration_id: str, source_system: str):
    """Phase 3: Graph-Enhancement (Agent-based)"""
    _write_chat_message(conn, migration_id, 'system', 'Phase 3: Graph-Enhancement starting...', 5)
    
    driver = None
    try:
        driver = _get_neo4j_driver()
    except Exception as e:
        _write_chat_message(conn, migration_id, 'system', f"Failed to connect to Neo4j for enhancement: {e}", 5)
        return

    # 1. Extract sample nodes
    _write_chat_message(conn, migration_id, 'system', 'Extracting sample nodes for relationship analysis...', 5)
    sample_data = []
    with driver.session() as session:
        # Get a few nodes of each entity type
        result = session.run(
            f"MATCH (n:`{source_system}`) WHERE n.migration_id = $migration_id "
            f"RETURN n.entity_type as type, collect(n)[..3] as samples",
            migration_id=str(migration_id)
        )
        for record in result:
            sample_data.append({
                "type": record["type"],
                "samples": [dict(node) for node in record["samples"]]
            })

    if not sample_data:
        _write_chat_message(conn, migration_id, 'system', 'No nodes found in Neo4j to enhance.', 5)
        return

    # 2. Agent-Call: Analyze relationships
    _write_chat_message(conn, migration_id, 'system', 'Analyzing potential relationships with AI...', 5)
    
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    prompt = f"""
    Ich habe folgende Nodes aus dem System '{source_system}' in Neo4j importiert (migration_id: '{migration_id}').
    Analysiere die Properties auf potenzielle Beziehungen (z.B. IDs die auf andere Nodes verweisen wie parent_id, project_id, user_id).
    
    Node-Beispiele:
    {json.dumps(sample_data, indent=2)}
    
    Generiere Cypher-Queries, um diese Beziehungen (Relationships) zu erstellen.
    Nutze MERGE und stelle sicher, dass die Beziehung nur innerhalb dieser migration_id ('{migration_id}') und für das Label '{source_system}' erstellt wird.
    
    WICHTIG:
    - Nutze `toString(item.property)` für ID Vergleiche, da Neo4j Properties als Strings gespeichert hat.
    - Die Nodes haben das Label `{source_system}` und die Property `external_id`.
    
    Gib NUR ein JSON-Array mit Cypher-Queries zurück: ["MATCH ... MERGE ...", "MATCH ..."].
    """
    
    try:
        chat_completion = client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            response_format={ "type": "json_object" }
        )
        # Expecting {"queries": ["..."]}
        response_json = json.loads(chat_completion.choices[0].message.content)
        queries = response_json.get("queries", [])
        
        if not queries and isinstance(response_json, list):
            queries = response_json
            
        # 3. Execute Cypher Queries
        _write_chat_message(conn, migration_id, 'system', f"Executing {len(queries)} enhancement queries...", 5)
        
        with driver.session() as session:
            for query in queries:
                try:
                    session.run(query)
                except Exception as query_error:
                    print(f"Error executing Cypher: {query_error}\nQuery: {query}")

        _write_chat_message(conn, migration_id, 'assistant', f"Graph enhancement complete. Created relationships based on AI analysis.", 5)
        
    except Exception as e:
        print(f"Graph enhancement agent failed: {e}")
        _write_chat_message(conn, migration_id, 'system', f"Graph enhancement failed: {e}", 5)
    finally:
        if driver:
            driver.close()

def _build_request_headers(scheme, connector):
    """Builds headers based on scheme authentication and connector credentials."""
    headers = {"Accept": "application/json"}
    
    # Add static headers from scheme
    if scheme.get('headers'):
        headers.update(scheme['headers'])
        
    auth_config = scheme.get('authentication', {})
    auth_type = auth_config.get('type')
    
    token = connector.get('api_key')
    username = connector.get('username')
    password = connector.get('password')
    
    if auth_type == 'bearer':
        if token:
            prefix = auth_config.get('tokenPrefix', 'Bearer ')
            headers['Authorization'] = f"{prefix}{token}"
            
    elif auth_type == 'header':
        header_name = auth_config.get('headerName', 'Authorization')
        prefix = auth_config.get('tokenPrefix', '')
        if token:
             headers[header_name] = f"{prefix}{token}"
             
    elif auth_type == 'basic':
        # Requests handles basic auth via the 'auth' parameter usually, 
        # but we can also set the header manually.
        if username:
            import base64
            creds = f"{username}:{password or ''}"
            b64_creds = base64.b64encode(creds.encode()).decode()
            headers['Authorization'] = f"Basic {b64_creds}"
            
    return headers

def _run_data_ingest_neo4j(conn: psycopg.Connection, migration_id: str, workflow_state: Dict[str, Any]):
    """Phase 2: Programmatic Data Import in Neo4j (Agent-Driven)"""
    _write_chat_message(conn, migration_id, 'system', 'Phase 2: Programmatic Data Import in Neo4j starting...', 5)
    
    # 1. Get migration info
    with conn.cursor() as cur:
        cur.execute("SELECT source_system, scope_config FROM public.migrations WHERE id = %s", (migration_id,))
        migration = cur.fetchone()
        
    source_system = migration['source_system']
    scope_config = migration['scope_config'] or {}
    
    # 2. Load scheme
    scheme = _load_system_scheme(source_system)
    if not scheme:
        _write_chat_message(conn, migration_id, 'system', f"Failed to load scheme for {source_system}. Skipping Neo4j ingest.", 5)
        return

    # 3. Get rate limit config
    rate_limit = workflow_state.get('rate_limit_config', {"delay": 1.0, "batch_size": 50})
    delay = rate_limit.get('delay', 1.0)
    
    # 4. Get entities from Step 3
    with conn.cursor() as cur:
        cur.execute("SELECT entity_name as name, count FROM public.step_3_results WHERE migration_id = %s", (migration_id,))
        entities = [dict(row) for row in cur.fetchall()]

    if not entities:
        _write_chat_message(conn, migration_id, 'system', "No entities found from Step 3. Skipping Neo4j ingest.", 5)
        return

    connector = _get_connector(conn, migration_id, 'in')
    if not connector:
        _write_chat_message(conn, migration_id, 'system', "Source connector not found. Skipping Neo4j ingest.", 5)
        return

    # Neo4j setup
    driver = None
    try:
        driver = _get_neo4j_driver()
    except Exception as e:
        _write_chat_message(conn, migration_id, 'system', f"Failed to connect to Neo4j: {e}. Skipping ingest.", 5)
        return
    
    # --- AGENT SETUP ---
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    
    system_prompt = f"""
    Du bist ein Data Ingestion Agent für {source_system}. Deine Aufgabe ist es, Daten über die API zu sammeln und in Neo4j zu speichern.
    
    ZIELE: {json.dumps(entities)}
    ENDPUNKTE:
    {json.dumps(scheme.get('discovery', {}).get('endpoints', {}), indent=2)}
    
    BASE_URL: {api_base_url}
    ANWEISUNGEN: {scheme.get('agentInstructions', 'Keine speziellen Anweisungen.')}

    REGELN:
    1. Analysiere die Endpunkte. Wenn ein Endpunkt Platzhalter hat (z.B. {{team_id}}), MUSST du zuerst die Eltern-Ressource abrufen (z.B. 'teams'), um die ID zu erhalten.
    2. Ersetze Platzhalter in der URL IMMER durch reale IDs, die du aus vorherigen Tool-Aufrufen erhalten hast.
    3. Die URLs müssen IMMER mit der BASE_URL beginnen.
    4. Nutze das Tool 'fetch_and_ingest', um Daten zu laden. Das Tool speichert die Daten direkt in Neo4j und gibt dir eine Zusammenfassung (inklusive gefundener IDs).
    5. Nutze die zurückgegebenen IDs, um die URLs für abhängige Ressourcen zu konstruieren.
    6. Gehe methodisch vor: Top-Level zuerst, dann Drill-Down.
    7. Wenn du alle Ziele erreicht hast oder nicht mehr weiterkommst, beende den Dialog.
    
    FORMAT:
    Antworte kurz mit deinen Gedanken und rufe dann das Tool auf.
    """
    
    messages = [
        {"role": "system", "content": system_prompt}
    ]
    
    tools = [
        {
            "type": "function",
            "function": {
                "name": "fetch_and_ingest",
                "description": "Ruft Daten von einer URL ab und speichert sie in Neo4j.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "entity_name": { "type": "string", "description": "Name der Entität (z.B. 'teams', 'tasks')." },
                        "url": { "type": "string", "description": "Die V OLLSTÄNDIGE URL (inkl. Base URL und aufgelösten Platzhaltern)." }
                    },
                    "required": ["entity_name", "url"]
                }
            }
        }
    ]
    
    total_imported = 0
    api_base_url = scheme.get('apiBaseUrl') or connector['api_url'].rstrip('/')
    
    # Keep track of coverage to avoid infinite loops
    attempted_urls = set()

    try:
        # Agent Loop (max 15 turns for safety)
        for turn in range(15):
            try:
                chat_completion = client.chat.completions.create(
                    messages=messages,
                    model=os.environ.get("OPENAI_MODEL", "gpt-4o"),
                    tools=tools,
                    tool_choice="auto"
                )
            except Exception as e:
                _write_chat_message(conn, migration_id, 'system', f"Agent interaction failed: {e}", 5)
                break
                
            message = chat_completion.choices[0].message
            messages.append(message)
            
            if message.content:
                 # Log thought process but keep it brief in UI
                 pass 

            if not message.tool_calls:
                _write_chat_message(conn, migration_id, 'system', "Agent finished ingestion plan.", 5)
                break
                
            for tool_call in message.tool_calls:
                if tool_call.function.name == "fetch_and_ingest":
                    args = json.loads(tool_call.function.arguments)
                    entity_name = args.get('entity_name')
                    url_suffix = args.get('url') # Agent might send full or relative. Let's normalize.
                    
                    # Normalize URL
                    if url_suffix.startswith('http'):
                        url = url_suffix
                    else:
                        # Ensure no double slashes
                        if not url_suffix.startswith('/'): url_suffix = '/' + url_suffix
                        url = api_base_url + url_suffix
                    
                    # Deduplication check
                    if url in attempted_urls:
                         tool_result = "Skipping: URL already processed."
                    else:
                        attempted_urls.add(url)
                        _write_chat_message(conn, migration_id, 'system', f"Agent fetching {entity_name} from {url}...", 5)
                        
                        # Execute Request
                        headers = _build_request_headers(scheme, connector)
                        try:
                            # Determine method (Notion search/query needs POST)
                            method = 'GET'
                            body = None
                            if '/search' in url or '/query' in url:
                                method = 'POST'
                                body = {}

                            if method == 'POST':
                                response = requests.post(url, headers=headers, json=body, timeout=30)
                            else:
                                response = requests.get(url, headers=headers, timeout=30)

                            if response.status_code == 200:
                                items = _extract_items(response.json(), entity_name)
                                _ingest_items_to_neo4j(driver, source_system, entity_name, items, migration_id)
                                
                                count = len(items)
                                total_imported += count
                                
                                # Extract sample IDs for the agent context
                                sample_ids = [str(i.get('id')) for i in items[:10] if i.get('id')]
                                tool_result = f"Success. Imported {count} items. Sample IDs found: {json.dumps(sample_ids)}"
                                
                            else:
                                tool_result = f"Error: HTTP {response.status_code} - {response.text[:200]}"
                        except Exception as req_err:
                            tool_result = f"Exception: {str(req_err)}"
                        
                        time.sleep(delay) # Rate limit

                    messages.append({
                        "tool_call_id": tool_call.tool_call_id,
                        "role": "tool",
                        "name": "fetch_and_ingest",
                        "content": tool_result
                    })
                    
    finally:
        if driver:
            driver.close()

    _write_chat_message(conn, migration_id, 'assistant', f"Phase 2 complete. {total_imported} objects imported to Neo4j.", 5)

def _run_rate_limit_calibration(conn: psycopg.Connection, migration_id: str):
    """Phase 1: Initial Rate-Limit Calibration (Agent-based)"""
    _write_chat_message(conn, migration_id, 'system', 'Phase 1: Initial Rate-Limit Calibration starting...', 5)
    
    connector = _get_connector(conn, migration_id, 'in')
    if not connector:
        raise Exception("Source connector not found for rate-limit calibration.")

    api_url = connector['api_url']
    auth_type = connector['auth_type']
    
    # ClickUp Fix: Use correct base URL and header format
    with conn.cursor() as cur:
        cur.execute("SELECT source_system FROM public.migrations WHERE id = %s", (migration_id,))
        source_system = cur.fetchone()['source_system']
    
    if source_system == 'ClickUp':
        api_url = "https://api.clickup.com/api/v2"

    # Prepare probe request
    headers = {"Accept": "application/json"}
    auth = None
    if auth_type == 'api_key' and connector['api_key']:
        if source_system == 'ClickUp':
            headers["Authorization"] = connector['api_key']
        else:
            headers["Authorization"] = f"Bearer {connector['api_key']}"
    elif auth_type == 'basic' and connector['username']:
        auth = (connector['username'], connector['password'] or "")

    # Perform Probe-Request
    try:
        # For ClickUp, probe /user to verify token
        probe_url = f"{api_url}/user" if source_system == 'ClickUp' else api_url.rstrip('/')
        _write_chat_message(conn, migration_id, 'system', f"Performing probe request to {probe_url}...", 5)
        response = requests.get(probe_url, headers=headers, auth=auth, timeout=10)
        
        response_data = {
            "status": response.status_code,
            "headers": dict(response.headers),
            "body": response.text[:1000]
        }
    except Exception as e:
        _write_chat_message(conn, migration_id, 'system', f"Probe request failed: {e}. Using default rate limits.", 5)
        return { "delay": 1.0, "batch_size": 50 }

    # Agent-Call: Analyze response with OpenAI
    _write_chat_message(conn, migration_id, 'system', 'Analyzing API response for rate limits...', 5)
    
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    prompt = f"""
    Analysiere diese API-Antwort und bestimme das optimale delay_seconds und die batch_size, 
    um sicher unter dem Rate-Limit zu bleiben. Berücksichtige Header wie 'X-RateLimit-Limit', 
    'Retry-After' oder ähnliche, falls vorhanden.
    
    API Antwort:
    Status: {response_data['status']}
    Headers: {json.dumps(response_data['headers'])}
    Body: {response_data['body']}
    
    Gib NUR ein JSON zurück im Format: {{ "delay": float, "batch_size": int }}.
    """
    
    try:
        chat_completion = client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            response_format={ "type": "json_object" }
        )
        result_json = json.loads(chat_completion.choices[0].message.content)
        
        # Prepare a structured result for the frontend
        frontend_result = {
            "status": "success",
            "phase": "Rate-Limit Calibration",
            "delay": result_json.get("delay"),
            "batch_size": result_json.get("batch_size"),
            "summary": f"Rate-Limits erfolgreich kalibriert: {result_json.get('delay')}s Verzögerung, Batch-Größe {result_json.get('batch_size')}.",
            "rawOutput": json.dumps(result_json)
        }
        _write_chat_message(conn, migration_id, 'assistant', json.dumps(frontend_result), 5)
        return result_json
    except Exception as e:
        print(f"Agent call failed: {e}")
        _write_chat_message(conn, migration_id, 'system', f"Agent analysis failed: {e}. Using defaults.", 5)
        return { "delay": 1.0, "batch_size": 50 }

# ----------------------------------------------------------------------------
# Agent Step Functions (Mocks)
# ----------------------------------------------------------------------------

def run_step_1_system_detection(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting System Detection...', 1)
    print(f"[{migration_id}] Running step 1: System Detection")
    time.sleep(2) # Simulate LLM call, curl, etc.
    result_message = "System detected: Jira Cloud. Curl Response: 200 OK"
    _write_chat_message(conn, migration_id, 'assistant', result_message, 1)

def run_step_2_auth_flow(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Authentication Flow...', 2)
    print(f"[{migration_id}] Running step 2: Authentication Flow")
    time.sleep(2)
    result_message = "Authentication successful. Received API token."
    _write_chat_message(conn, migration_id, 'assistant', result_message, 2)

def run_step_3_capability_discovery(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Capability Discovery...', 3)
    print(f"[{migration_id}] Running step 3: Capability Discovery")
    time.sleep(2)
    result_message = "Discovered capabilities: issue tracking, project management."
    _write_chat_message(conn, migration_id, 'assistant', result_message, 3)

def run_step_4_schema_generation(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Schema Generation...', 4)
    print(f"[{migration_id}] Running step 4: Schema Generation")
    time.sleep(2)
    result_message = "Schema generated for source and target systems."
    _write_chat_message(conn, migration_id, 'assistant', result_message, 4)

def run_step_5_data_staging(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Data Staging Engine...', 5)
    print(f"[{migration_id}] Running step 5: Data Staging Engine")
    
    # Read current workflow_state
    with conn.cursor() as cur:
        cur.execute("SELECT workflow_state FROM public.migrations WHERE id = %s", (migration_id,))
        row = cur.fetchone()
        workflow_state = row['workflow_state'] if row and row['workflow_state'] else {}
    
    # Phase 1: Rate-Limit Calibration
    rate_limit_config = _run_rate_limit_calibration(conn, migration_id)
    workflow_state['rate_limit_config'] = rate_limit_config
    _update_workflow_state(conn, migration_id, workflow_state)

    # Phase 2: Neo4j Ingest
    _run_data_ingest_neo4j(conn, migration_id, workflow_state)

    # Phase 3: Graph-Enhancement
    with conn.cursor() as cur:
        cur.execute("SELECT source_system FROM public.migrations WHERE id = %s", (migration_id,))
        source_system = cur.fetchone()['source_system']
    _run_graph_enhancement(conn, migration_id, source_system)

    # Phase 4: Reconciliation
    actual_count = _run_reconciliation(conn, migration_id, source_system)

    # Finalize Step 5
    if 'staging' not in workflow_state:
        workflow_state['staging'] = {}
    
    workflow_state['staging']['completed_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
    workflow_state['staging']['objects_staged'] = actual_count
    workflow_state['staging']['status'] = 'completed'
    
    _update_workflow_state(conn, migration_id, workflow_state)
    
    # Update migration objects_transferred for progress display
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE public.migrations SET objects_transferred = %s WHERE id = %s",
            (f"{actual_count}/{actual_count}", migration_id)
        )
        conn.commit()

    # Success message
    result_message = f"Data Staging Engine completed successfully. {actual_count} objects are now available in the graph database for mapping and transformation."
    _write_chat_message(conn, migration_id, 'assistant', result_message, 5)
    
    # Add action buttons for the user
    _write_action_buttons(conn, migration_id, 5, next_step_title="Mapping Suggestions")

    # CRITICAL: Update status to completed LAST
    # This ensures the frontend finds the action buttons as soon as it sees step_status 'completed'
    _update_migration_step_status(conn, migration_id, 5, 'completed')

def run_step_6_data_fetching(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Data Fetching...', 6)
    print(f"[{migration_id}] Running step 6: Data Fetching")
    time.sleep(2)
    result_message = "Fetched 100 issues from source system."
    _write_chat_message(conn, migration_id, 'assistant', result_message, 6)

def run_step_7_data_transformation(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Data Transformation...', 7)
    print(f"[{migration_id}] Running step 7: Data Transformation")
    time.sleep(2)
    result_message = "Transformed 100 issues for target system."
    _write_chat_message(conn, migration_id, 'assistant', result_message, 7)

def run_step_8_data_loading(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Data Loading...', 8)
    print(f"[{migration_id}] Running step 8: Data Loading")
    time.sleep(2)
    result_message = "Loaded 100 issues into target system."
    _write_chat_message(conn, migration_id, 'assistant', result_message, 8)

def run_step_9_validation(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Validation...', 9)
    print(f"[{migration_id}] Running step 9: Validation")
    time.sleep(2)
    result_message = "Data validation successful. All items match."
    _write_chat_message(conn, migration_id, 'assistant', result_message, 9)

def run_step_10_cleanup(conn: psycopg.Connection, migration_id: str, payload: Dict[str, Any]):
    _write_chat_message(conn, migration_id, 'system', 'Starting Cleanup...', 10)
    print(f"[{migration_id}] Running step 10: Cleanup")
    time.sleep(2)
    result_message = "Cleanup complete. Migration finished. [Download Report](/reports/migration_report_123.pdf)"
    _write_chat_message(conn, migration_id, 'assistant', result_message, 10)


# ----------------------------------------------------------------------------
# Worker & Dispatcher
# ----------------------------------------------------------------------------

STEP_DISPATCHER: Dict[int, Callable] = {
    1: run_step_1_system_detection,
    2: run_step_2_auth_flow,
    3: run_step_3_capability_discovery,
    4: run_step_4_schema_generation,
    5: run_step_5_data_staging,
    6: run_step_6_data_fetching,
    7: run_step_7_data_transformation,
    8: run_step_8_data_loading,
    9: run_step_9_validation,
    10: run_step_10_cleanup,
}

def process_migration_step(job_payload: Dict[str, Any]):
    """Main processing function for a single migration step."""
    migration_id = job_payload.get("migrationId")
    step_number = job_payload.get("stepNumber")

    if not migration_id or not step_number:
        print(f" [!] Invalid job payload, missing migrationId or stepNumber: {job_payload}")
        return

    step_function = STEP_DISPATCHER.get(step_number)
    if not step_function:
        print(f" [!] No handler for step {step_number} in migration {migration_id}")
        return
        
    db_conn = None
    try:
        db_conn = _get_db_connection()
        _update_migration_step_status(db_conn, migration_id, step_number, 'running')
        
        step_function(db_conn, migration_id, job_payload)
        
        _update_migration_step_status(db_conn, migration_id, step_number, 'completed')

        print(f" [{migration_id}] Step {step_number} completed successfully.")

    except Exception as e:
        print(f" [!] Error processing step {step_number} for migration {migration_id}: {e}")
        if db_conn:
            _update_migration_step_status(db_conn, migration_id, step_number, 'failed', str(e))
            _write_chat_message(db_conn, migration_id, 'system', f"Error during step {step_number}: {e}", step_number)
    finally:
        if db_conn:
            db_conn.close()


def get_rabbitmq_connection():
    """Establishes a connection to RabbitMQ, retrying if necessary."""
    rabbitmq_host = os.getenv("RABBITMQ_HOST", "localhost")
    rabbitmq_user = os.getenv("RABBITMQ_DEFAULT_USER", "guest")
    rabbitmq_pass = os.getenv("RABBITMQ_DEFAULT_PASS", "guest")
    credentials = pika.PlainCredentials(rabbitmq_user, rabbitmq_pass)
    connection_attempts = 10
    for i in range(connection_attempts):
        try:
            connection = pika.BlockingConnection(pika.ConnectionParameters(host=rabbitmq_host, credentials=credentials))
            print("Successfully connected to RabbitMQ.")
            return connection
        except pika.exceptions.AMQPConnectionError as e:
            print(f"Failed to connect to RabbitMQ (attempt {i+1}/{connection_attempts}): {e}")
            if i < connection_attempts - 1:
                time.sleep(5)
            else:
                raise

def callback(ch, method, properties, body):
    """Callback function to process messages from the queue."""
    print(f" [x] Received message: {body.decode()}")
    
    try:
        message_data = json.loads(body)
        job_id = message_data.get('job_id')
        
        if not job_id:
            print(" [!] No job_id found in message.")
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        # Fetch the full job details from the database
        db_conn = _get_db_connection()
        try:
            with db_conn.cursor() as cur:
                cur.execute("SELECT payload FROM public.jobs WHERE id = %s", (job_id,))
                row = cur.fetchone()
                if not row:
                    print(f" [!] Job {job_id} not found in database.")
                    ch.basic_ack(delivery_tag=method.delivery_tag)
                    return
                
                # Payload is stored as JSON in the database
                job_payload = row['payload']
                if isinstance(job_payload, str):
                    job_payload = json.loads(job_payload)
                
                # Update job status to running
                cur.execute("UPDATE public.jobs SET status = 'running' WHERE id = %s", (job_id,))
                db_conn.commit()
                
                # Now process the actual migration step
                process_migration_step(job_payload)
                
                # Update job status to completed
                cur.execute("UPDATE public.jobs SET status = 'completed' WHERE id = %s", (job_id,))
                db_conn.commit()

        finally:
            db_conn.close()

        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as e:
        print(f" [!] Error processing message: {e}")
        # In case of error, we should probably mark the job as failed in DB too
        try:
            message_data = json.loads(body)
            job_id = message_data.get('job_id')
            if job_id:
                db_conn = _get_db_connection()
                with db_conn.cursor() as cur:
                    cur.execute("UPDATE public.jobs SET status = 'failed', last_error = %s WHERE id = %s", (str(e), job_id))
                    db_conn.commit()
                db_conn.close()
        except:
            pass
        ch.basic_ack(delivery_tag=method.delivery_tag) # Ack even on fail to avoid infinite loops, but marked as failed in DB

def main():
    """Main function to start the worker."""
    print("Starting migration worker...")
    connection = get_rabbitmq_connection()
    channel = connection.channel()

    queue_name = 'migration_tasks'
    channel.queue_declare(queue=queue_name, durable=True)

    print(f" [*] Waiting for messages in queue '{queue_name}'. To exit press CTRL+C")
    
    channel.basic_consume(queue=queue_name, on_message_callback=callback)

    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        print("Stopping consumer.")
        channel.stop_consuming()
    finally:
        connection.close()
        print("RabbitMQ connection closed.")

if __name__ == '__main__':
    main()