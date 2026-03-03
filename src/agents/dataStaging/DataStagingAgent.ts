import { AgentBase } from '../core/AgentBase';
import { Tool, ChatMessage } from '../core/LlmProvider';
import { loadScheme } from '../../lib/scheme-loader';
import neo4j from 'neo4j-driver';

// Helper function to extract items
function _extractItems(data: any, entityName: string): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    if (data[entityName] && Array.isArray(data[entityName])) return data[entityName];
    if (data.items && Array.isArray(data.items)) return data.items;
    if (data.data && Array.isArray(data.data)) return data.data;
    if (data.results && Array.isArray(data.results)) return data.results;
    for (const key in data) {
        if (Array.isArray(data[key])) return data[key];
    }
  }
  return [];
}

// Minimal sanitization helper
function sanitizeForNeo4j(obj: any): any {
  const sanitized: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      sanitized[key] = value.filter(v => typeof v !== 'object').map(v => String(v));
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = JSON.stringify(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// Function to handle ingestion
async function _ingestToNeo4j(driver: any, systemName: string, entityType: string, items: any[], migrationId: string) {
    if (!items || items.length === 0) return;
    
    const session = driver.session();
    try {
        const getExternalId = (item: any) => {
            return item.gid || item.id || item.uuid || item.key || item.external_id || null;
        };

        const BATCH_SIZE = 500;
        for (let i = 0; i < items.length; i += BATCH_SIZE) {
            const batch = items.slice(i, i + BATCH_SIZE).map((item: any) => {
                const flatItem = item;
                const extId = getExternalId(item);
                const sanitized = sanitizeForNeo4j(flatItem);
                
                return {
                    migration_id: migrationId,
                    entity_type: entityType,
                    external_id: extId ? String(extId) : null,
                    ...sanitized
                };
            });

            const safeLabel = systemName.replace(/[^a-zA-Z0-9]/g, '_');
            
            const query = `
                UNWIND $batch AS props
                CREATE (n:\`${safeLabel}\`)
                SET n = props
            `;
            
            await session.run(query, { batch });
        }
    } catch (e) {
        console.error(`[_ingestToNeo4j] Failed to ingest batch for ${entityType}:`, e);
        throw e;
    } finally {
        await session.close();
    }
}

export class DataStagingAgent extends AgentBase {
  async execute(params: any): Promise<any> {
    const { stepNumber, migrationId, dbPool } = this.context;
    
    if (!dbPool) {
        return { success: false, error: "Database pool not provided in context", isLogicalFailure: true };
    }

    console.log(`[DataStagingAgent] Running Data Staging for migration ${migrationId}`);
    await this.context.writeChatMessage('assistant', 'Bereite Daten für das Mapping vor (Data Staging)...', stepNumber);

    await this.context.writeChatMessage('assistant', 'Phase 1: Initiale Rate-Limit Kalibrierung startet...', stepNumber);
    
    const connector = await this.context.getConnector('in');
    const migrationDetails = await this.context.getMigrationDetails();
    const sourceSystem = migrationDetails?.source_system;
    const instructions = migrationDetails?.notes;
    const scopeConfig = migrationDetails?.scope_config;
    const scheme = await loadScheme(sourceSystem);

    let effectiveApiUrl = scheme?.apiBaseUrl || connector?.api_url || "";
    effectiveApiUrl = effectiveApiUrl.replace(/\/$/, "");

    const stagingLogs: string[] = [];
    const phase3Logs: string[] = [];
    let relRules: any[] = [];

    let rateLimitResult = { delay: 1.0, batch_size: 50 };

    if (connector && effectiveApiUrl) {
        const probeUrl = sourceSystem === 'ClickUp' ? `${effectiveApiUrl}/api/v2/user` : (scheme?.authentication?.whoami?.endpoint ? `${effectiveApiUrl}${scheme.authentication.whoami.endpoint}` : effectiveApiUrl);
        await this.context.writeChatMessage('assistant', `Führe Probe-Anfrage durch an ${probeUrl}...`, stepNumber);
        
        const headers: any = { 
            "Accept": "application/json",
            ...(scheme?.headers || {})
        };
        if (connector.auth_type === 'api_key' && connector.api_key) {
            headers["Authorization"] = sourceSystem === 'ClickUp' ? connector.api_key : `Bearer ${connector.api_key}`;
        }

        try {
            console.log(`[DataStagingAgent] Performing rate-limit probe to: ${probeUrl}`);
            const probeRes = await fetch(probeUrl, { headers });
            const resHeaders: any = {};
            probeRes.headers.forEach((v, k) => { resHeaders[k] = v; });
            const resBody = await probeRes.text();
            
            console.log(`[DataStagingAgent] Probe response headers:`, JSON.stringify(resHeaders));

            const hasRateLimitHeaders = Object.keys(resHeaders).some(h => h.toLowerCase().includes('ratelimit') || h.toLowerCase().includes('retry-after'));

            const calibrationPrompt = `
              Analysiere diese API-Antwort und bestimme das optimale delay (in Sekunden, float) und die batch_size (int), 
              um sicher unter dem Rate-Limit zu bleiben. Berücksichtige Header wie 'X-RateLimit-Limit', 'Retry-After' etc.
              
              API Antwort von ${sourceSystem}:
              Status: ${probeRes.status}
              Headers: ${JSON.stringify(resHeaders)}
              Body: ${resBody.substring(0, 1000)}
              
              Gib NUR ein JSON zurück: { "delay": float, "batch_size": int }
            `;

            const calResult = await this.provider.chat([
                { role: "user", content: calibrationPrompt }
            ], undefined, {
                model: process.env.OPENAI_MODEL || "gpt-4o-mini",
                response_format: { type: "json_object" }
            });
            
            const parsedCal = JSON.parse(calResult.choices[0].message.content || "{}");
            if (parsedCal.delay !== undefined) rateLimitResult = parsedCal;

            const frontendResult = {
              status: "success",
              phase: "Rate-Limit Calibration",
              delay: rateLimitResult.delay,
              batch_size: rateLimitResult.batch_size,
              summary: hasRateLimitHeaders 
                  ? `Rate-Limits basierend auf API-Headern kalibriert: ${rateLimitResult.delay}s Verzögerung, Batch-Größe ${rateLimitResult.batch_size}.`
                  : `Keine Rate-Limit Header gefunden. Nutze geschätzte Sicherheits-Werte: ${rateLimitResult.delay}s Verzögerung, Batch-Größe ${rateLimitResult.batch_size}.`,
              rawOutput: JSON.stringify(rateLimitResult)
            };
            await this.context.writeChatMessage('assistant', JSON.stringify(frontendResult), stepNumber);
        } catch (e: any) {
            await this.context.writeChatMessage('assistant', `Probe fehlgeschlagen: ${e.message}. Nutze Standardwerte.`, stepNumber);
        }
    }

    await this.context.writeChatMessage('assistant', 'Phase 2: Programmatischer Datenimport in Neo4j startet...', stepNumber);
    
    const { rows: step3Rows } = await dbPool.query('SELECT entity_name, count FROM step_3_results WHERE migration_id = $1', [migrationId]);
    const userRelatedTerms = ['user', 'member', 'participant', 'assignee', 'owner', 'creator', 'author', 'collaborator'];
    const entities = step3Rows
      .map((r: any) => ({ name: r.entity_name, count: r.count }))
      .filter((ent: any) => {
        const nameLower = ent.name.toLowerCase();
        const isUserRelated = userRelatedTerms.some(term => nameLower.includes(term));
        return ent.count > 0 && !isUserRelated;
      });
    
    let totalImported = 0;
    let validationErrors = 0;
    const driver = neo4j.driver(
      process.env.NEO4J_URI || "bolt://neo4j-db:7687",
      neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "password")
    );

    const addStagingLog = (msg: string) => {
        stagingLogs.push(`[${new Date().toLocaleTimeString('de-DE')}] ${msg}`);
    };

    const cleanupSession = driver.session();
    try {
        addStagingLog('Bereinige alte Daten in Neo4j...');
        await cleanupSession.run('MATCH (n { migration_id: $migrationId }) DETACH DELETE n', { migrationId });
    } finally {
        await cleanupSession.close();
    }

    const agentSystemPrompt = `
      Du bist ein Data Ingestion Agent für ${sourceSystem}. Deine Aufgabe ist es, Daten über die API zu sammeln und in Neo4j zu speichern.
      
      ### NAVIGATION GUIDE (Strikte Befolgung erforderlich):
      ${JSON.stringify(scheme?.navigationGuide || "Kein Guide vorhanden.", null, 2)}

      ZIELE: ${JSON.stringify(entities)}
      ENDPUNKTE: ${JSON.stringify(scheme?.discovery?.endpoints || {})}
      BASE_URL: ${effectiveApiUrl}
      SCOPE: ${JSON.stringify(scopeConfig || {})}
      ANWEISUNGEN: ${scheme?.agentInstructions || 'Keine speziellen Anweisungen.'}
      
      ### STRIKTE SCOPE-BESCHRÄNKUNG:
      ${scopeConfig?.sourceScope ? `
      ACHTUNG: Dies ist eine BEREICHS-MIGRATION (Scope: ${scopeConfig.sourceScopeName || scopeConfig.sourceScope}).
      - Nutze NIEMALS globale Such-Endpunkte oder Endpunkte, die alle Objekte des Systems auflisten (z.B. '/api/1.0/tasks/search').
      - Folge zwingend der Hierarchie im NAVIGATION GUIDE (z.B. erst Projekt abrufen, dann Aufgaben NUR dieses Projekts).
      - Jedes Objekt, das du importierst, MUSS direkt oder indirekt zum oben genannten SCOPE gehören.
      ` : 'Dies ist eine VOLL-MIGRATION. Du kannst globale Endpunkte nutzen, um alle Daten zu erfassen.'}

      REGELN:
      1. **NAVIGATION GUIDE:** Folge strikt dem oben stehenden Navigation Guide, um IDs zu ermitteln.
      2. **KEINE PLATZHALTER:** Nutze NIEMALS URLs mit geschweiften Klammern. Ersetze diese durch reale IDs aus vorherigen Tool-Antworten.
      3. **KEINE HALLUZINATIONEN:** Erfinde NIEMALS IDs (wie '12345'). Wenn du eine ID nicht hast, rufe zuerst den Parent-Endpunkt auf.
      4. Die URLs müssen IMMER mit der BASE_URL beginnen.
      5. Nutze das Tool 'fetch_and_ingest'. Es speichert die Daten und gibt dir eine Liste der gefundenen IDs zurück.
      6. **VOLLSTÄNDIGKEIT:** Versuche alle ZIELE zu erreichen.
      7. **SCOPE:** Falls ein SCOPE definiert ist, beschränke dich darauf.
      8. **METHODEN:** Beachte die HTTP-Methode (GET/POST).
    `;

    let messages: ChatMessage[] = [{ role: "system", content: agentSystemPrompt }];
    const tools: Tool[] = [{
        type: "function",
        function: {
            name: "fetch_and_ingest",
            description: "Fetch data from a URL and store it in Neo4j.",
            parameters: {
                type: "object",
                properties: {
                    entity_name: { type: "string" },
                    url: { type: "string", description: "Vollständige URL mit aufgelösten Platzhaltern." },
                    method: { type: "string", enum: ["GET", "POST"], description: "HTTP Methode. Standard: GET." },
                    body: { type: "object", description: "Request Body für POST Anfragen (z.B. Filter)." }
                },
                required: ["entity_name", "url"]
            }
        }
    }];

    const attemptedUrls = new Set<string>();

    try {
        for (let turn = 0; turn < 15; turn++) {
            const response = await this.provider.chat(messages, tools, { tool_choice: "auto" });
            const aiMessage = response.choices[0].message;
            messages.push(aiMessage);

            if (!aiMessage.tool_calls || aiMessage.tool_calls.length === 0) break;

            for (const toolCall of aiMessage.tool_calls) {
                const args = JSON.parse(toolCall.function.arguments);
                const { entity_name, url } = args;

                if (attemptedUrls.has(url)) {
                    messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: "URL already processed." });
                    continue;
                }
                attemptedUrls.add(url);
                addStagingLog(`Agent ruft ${entity_name} von ${url} ab...`);

                const headers: any = { 
                    "Accept": "application/json",
                    ...(scheme?.headers || {})
                };
                
                if (connector.auth_type === 'api_key' && connector.api_key) {
                    const authConfig = scheme?.authentication;
                    if (authConfig?.type === 'header') {
                        const name = authConfig.headerName || 'Authorization';
                        const prefix = authConfig.tokenPrefix !== undefined ? authConfig.tokenPrefix : 'Bearer ';
                        headers[name] = `${prefix}${connector.api_key}`;
                    } else {
                        headers["Authorization"] = `Bearer ${connector.api_key}`;
                    }
                } else if (connector.auth_type === 'basic' && connector.api_key) {
                    headers["Authorization"] = `Basic ${connector.api_key}`;
                }

                try {
                    const method = args.method || 'GET';
                    let body = args.body ? JSON.stringify(args.body) : undefined;
                    
                    if (method === 'POST' && !body) {
                        body = JSON.stringify({});
                    }

                    const res = await fetch(url, { method, headers, body });
                    if (res.ok) {
                        const data = await res.json();
                        const items = _extractItems(data, entity_name);
                        if (items.length > 0) {
                            await _ingestToNeo4j(driver, sourceSystem, entity_name, items, migrationId);
                            totalImported += items.length;
                            const sampleIds = items.slice(0, 5).map((i: any) => i.gid || i.id || i.key || i.uuid);
                            messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: `Success. Imported ${items.length} items. Sample IDs: ${JSON.stringify(sampleIds)}` });
                            addStagingLog(`${items.length} ${entity_name} importiert.`);
                        } else {
                            messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: "No items found in response." });
                        }
                    } else {
                        messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: `Error: HTTP ${res.status}` });
                        addStagingLog(`Fehler beim Abruf von ${entity_name}: HTTP ${res.status}`);
                    }
                } catch (e: any) {
                    messages.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: `Fetch error: ${e.message}` });
                    addStagingLog(`Abruffehler bei ${entity_name}: ${e.message}`);
                }
                await new Promise(r => setTimeout(r, rateLimitResult.delay * 1000));
            }
        }

        console.log(`[DataStagingAgent] Phase 2 Ingestion complete. Starting Phase 3 for migration ${migrationId}`);
        await this.context.writeChatMessage('assistant', 'Phase 3: Automatische Beziehungserkennung startet...', stepNumber);
        
        const addPhase3Log = (msg: string) => {
            phase3Logs.push(`[${new Date().toLocaleTimeString('de-DE')}] ${msg}`);
        };

        addPhase3Log('Analysiere Datenstruktur in Neo4j...');
        
        const schemaSample: Record<string, any> = {};
        const idSamples: Record<string, string[]> = {};
        const schemaSession = driver.session();
        try {
            const typesRes = await schemaSession.run(
                `MATCH (n {migration_id: $migrationId}) RETURN DISTINCT n.entity_type as type`, 
                { migrationId }
            );
            const entityTypes = typesRes.records.map(r => r.get('type')).filter(t => t);
            
            for (const type of entityTypes) {
                const sampleRes = await schemaSession.run(
                    `MATCH (n {migration_id: $migrationId, entity_type: $type}) RETURN properties(n) as props LIMIT 1`,
                    { migrationId, type }
                );
                if (sampleRes.records.length > 0) {
                    schemaSample[type] = sampleRes.records[0].get('props');
                }

                const idsRes = await schemaSession.run(
                    `MATCH (n {migration_id: $migrationId, entity_type: $type}) RETURN n.external_id as id LIMIT 5`,
                    { migrationId, type }
                );
                idSamples[type] = idsRes.records.map(r => r.get('id'));
            }
        } finally {
            await schemaSession.close();
        }

        let totalRelsCreated = 0;
        if (Object.keys(schemaSample).length > 0) {
            const discoveryPrompt = `
              Du bist eine technische Schnittstelle für das System ${sourceSystem}. Deine Antwort wird direkt von einem automatisierten Parser verarbeitet.
              
              ### STRIKTE AUSGABE-REGELN:
              1. ANTWORTE AUSSCHLIESSLICH im folgenden JSON-Format: {"rules": [{"from": "string", "to": "string", "field": "string", "type": "string"}]}
              2. Wenn du keine Beziehungen findest, antworte mit: {"rules": []}
              3. Erzeuge KEINEN Markdown-Codeblock, KEINE Erklärungen, nur das nackte JSON Objekt.
              
              ### VALIDIERUNG DES VOKABULARS:
              - Für 'from' und 'to' darfst du NUR exakte Werte aus dieser Liste verwenden: ${JSON.stringify(Object.keys(schemaSample))}
              - Für 'field' darfst du NUR exakte Property-Namen aus den unten stehenden Beispielen verwenden.
              - Jede Abweichung in der Schreibweise führt zum Systemabbruch.
              
              ### BEISPIEL FÜR EINE KORREKTE ANTWORT:
              {"rules": [{"from": "tasks", "to": "tasks", "field": "parent_id", "type": "SUBTASK_OF"}, {"from": "tasks", "to": "users", "field": "creator_id", "type": "CREATED_BY"}]}
              
              ### DATEN-KONTEXT FÜR ${sourceSystem}:
              VERFÜGBARE OBJEKTTYPEN & BEISPIELE:
              ${JSON.stringify(schemaSample, null, 2)}
              
              BEISPIEL-IDS PRO TYP (ZUM ABGLEICH):
              ${JSON.stringify(idSamples, null, 2)}
              
              ### AUFGABE:
              Analysiere die Properties auf Foreign Keys (z.B. 'parent', 'project', 'user', 'list_id'). Achte besonders auf Selbst-Referenzen (Subtasks). Nutze fachlich korrekte Beziehungsnamen für ${sourceSystem} (z.B. 'SUBTASK_OF', 'IN_LIST', 'ASSIGNED_TO').
            `;

            const discoveryRes = await this.provider.chat([
                { role: "user", content: discoveryPrompt }
            ], undefined, { response_format: { type: "json_object" } });

            const rawContent = discoveryRes.choices[0].message.content || "[]";
            try {
                const parsed = JSON.parse(rawContent);
                if (Array.isArray(parsed)) {
                    relRules = parsed;
                } else if (parsed.relations && Array.isArray(parsed.relations)) {
                    relRules = parsed.relations;
                } else if (parsed.rules && Array.isArray(parsed.rules)) {
                    relRules = parsed.rules;
                } else if (parsed.from && parsed.to && parsed.field) {
                    relRules = [parsed];
                }
            } catch (e) {
                addPhase3Log(`Fehler beim Parsen der Agenten-Antwort.`);
            }

            if (relRules.length > 0) {
                addPhase3Log(`${relRules.length} potenzielle Beziehungstypen identifiziert.`);
                const linkSession = driver.session();
                try {
                    for (const rule of relRules) {
                        if (!schemaSample[rule.from] || !schemaSample[rule.to]) {
                            addPhase3Log(`-> Überspringe Regel '${rule.type}': Typ '${!schemaSample[rule.from] ? rule.from : rule.to}' unbekannt.`);
                            continue;
                        }

                        const safeLabelFrom = sourceSystem.replace(/[^a-zA-Z0-9]/g, '_');
                        const safeLabelTo = sourceSystem.replace(/[^a-zA-Z0-9]/g, '_');
                        const linkQuery = `
                          MATCH (a:\`${safeLabelFrom}\` {migration_id: $migrationId, entity_type: $fromType})
                          MATCH (b:\`${safeLabelTo}\` {migration_id: $migrationId, entity_type: $toType})
                          WHERE a.\`${rule.field}\` IS NOT NULL 
                            AND toString(a.\`${rule.field}\`) = b.external_id
                            AND a <> b
                          MERGE (a)-[r:\`${rule.type}\` {migration_id: $migrationId}]->(b)
                          RETURN count(r) as count
                        `;
                        const result = await linkSession.run(linkQuery, { 
                            migrationId, 
                            fromType: rule.from, 
                            toType: rule.to 
                        });
                        const count = result.records[0].get('count').toNumber();
                        if (count > 0) {
                            totalRelsCreated += count;
                            addPhase3Log(`-> ${count} Beziehungen vom Typ '${rule.type}' zwischen '${rule.from}' und '${rule.to}' erstellt.`);
                        } else {
                            addPhase3Log(`-> Regel '${rule.type}' identifiziert, aber keine passenden Datensätze gefunden.`);
                        }
                    }
                } finally {
                    await linkSession.close();
                }
            }
        }
        addPhase3Log('Phase 3 abgeschlossen.');
        
        const phase3Result = {
            status: "success",
            phase: "Relationship Discovery",
            summary: `Strukturanalyse beendet: ${totalRelsCreated} Beziehungen im Graph automatisch identifiziert und verknüpft.`,
            rawOutput: `### Identifizierte Regeln:\n${relRules.length > 0 ? relRules.map((r: any) => `- **${r.type}**: ${r.from}.${r.field} -> ${r.to}`).join('\n') : 'Keine Regeln gefunden.'}\n\n### Protokoll:\n${phase3Logs.join('\n')}`
        };
        await this.context.writeChatMessage('assistant', JSON.stringify(phase3Result), stepNumber);
        
        await this.context.writeChatMessage('assistant', 'Phase 4: Validierung der Datenintegrität...', stepNumber);
        
        const validationLogs: string[] = [];
        const addValidationLog = (msg: string) => {
            validationLogs.push(`[${new Date().toLocaleTimeString('de-DE')}] ${msg}`);
        };
        
        const validationSession = driver.session();
        try {
            for (const entity of entities) {
                const result = await validationSession.run(
                    `MATCH (n {migration_id: $migrationId, entity_type: $entityType}) RETURN count(n) as count`,
                    { migrationId, entityType: entity.name }
                );
                const actualCount = result.records[0].get('count').toNumber();
                const expectedCount = entity.count;
                
                const match = actualCount === expectedCount;
                if (!match) validationErrors++;
                
                const icon = match ? '✅' : '⚠️';
                const msg = `${icon} Entity '${entity.name}': Erwartet ${expectedCount}, Gefunden ${actualCount}.`;
                addValidationLog(msg);
            }
        } catch (error: any) {
            addValidationLog(`❌ Validierungsfehler: ${error.message}`);
            validationErrors++;
        } finally {
            await validationSession.close();
        }
        
        const validationSummary = validationErrors === 0 
            ? `Validierung erfolgreich: Alle ${entities.length} Entitätstypen sind vollständig vorhanden.`
            : `Validierung abgeschlossen mit ${validationErrors} Abweichungen.`;
            
        const validationResultObj = {
            status: validationErrors === 0 ? "success" : "warning",
            phase: "Validation",
            summary: validationSummary,
            rawOutput: validationLogs.join('\n')
        };
        await this.context.writeChatMessage('assistant', JSON.stringify(validationResultObj), stepNumber);

    } finally {
        await driver.close();
    }

    const protocolResult = {
        status: totalImported > 0 ? "success" : "error",
        phase: "Data Ingestion Protocol",
        summary: `Daten-Import und Graph-Strukturierung abgeschlossen: ${totalImported} Objekte geladen.`,
        rawOutput: stagingLogs.join('\n')
    };
    await this.context.writeChatMessage('assistant', JSON.stringify(protocolResult), stepNumber);

    let isLogicalFailure = false;
    let failureMessage = "";

    if (totalImported === 0) {
        isLogicalFailure = true;
        failureMessage = "Es konnten keine Daten aus dem Quellsystem geladen werden. Bitte überprüfen Sie die Berechtigungen und die Quell-URL.";
    } else if (validationErrors > (entities.length * 0.5)) { 
        isLogicalFailure = true;
        failureMessage = `Datenerfassung unvollständig: ${validationErrors} Abweichungen bei der Validierung gefunden.`;
    }

    const result = { 
        status: isLogicalFailure ? 'failed' : (validationErrors > 0 ? 'warning' : 'success'), 
        message: isLogicalFailure ? failureMessage : 'Data Staging abgeschlossen (mit Warnungen).', 
        stagedCount: totalImported, 
        urls: Array.from(attemptedUrls), 
        logs: stagingLogs,
        phase3Logs: phase3Logs
    };

    return {
        success: !isLogicalFailure,
        result,
        isLogicalFailure,
        error: failureMessage,
        totalImported 
    };
  }
}
