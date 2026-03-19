import { AgentBase, AgentContext } from '../../core/AgentBase';
import { LlmProvider, ChatMessage, Tool } from '../../core/LlmProvider';
import { ExecutionTask } from '../state/types';
import neo4j from 'neo4j-driver';

export interface SubagentParams {
  task: ExecutionTask;
  mappingRules: any[];
  idMappings: Record<string, Record<string, string>>; // Dependency mappings (e.g., users -> asana_users)
  sourceSchema: any;
  targetSchema: any;
  sourceSystem: string;
  targetSystem: string;
  targetScopeId: string | null;
}

export interface SubagentResult {
  success: boolean;
  newMappings: Record<string, string>; // Mapping of source_id -> target_id for the current entity type
  error?: string;
  logs: string[];
}

export class TaskSubagent extends AgentBase {
  constructor(provider: LlmProvider, context: AgentContext) {
    super(provider, context);
  }

  async execute(params: SubagentParams): Promise<SubagentResult> {
    const { task, mappingRules, idMappings, sourceSchema, targetSchema, sourceSystem, targetSystem, targetScopeId } = params;

    const systemPrompt = `Du bist ein hochspezialisierter Data Transfer Worker Agent.
Deine einzige Aufgabe ist es, einen spezifischen Teil der Migration durchzuführen: "${task.description}".

### DEIN ZIEL:
Du bist zuständig für die Transformation von Quell-Entitäten vom Typ "${task.sourceEntityType}" zu Ziel-Entitäten vom Typ "${task.targetEntityType}".

### WERKZEUGE:
Dir stehen Tools zur Verfügung, um Daten zu lesen und zu schreiben.
1. 'fetch_source_data': Lade die zu migrierenden Daten für "${task.sourceEntityType}" aus unserer Datenbank (Neo4j).
2. 'push_mapped_data': Sende die transformierten Daten an das Zielsystem. Erstelle dafür den REST API Request.
3. 'finish_task': Beendet den Task.

### REGELN FÜR PUSH_MAPPED_DATA (WICHTIG):
1. Nutze als Basis-URL die Ziel-Spezifikationen. Beachte Platzhalter in URLs.
2. Wenn du einen API-Body (Payload) erstellst, wende das Mapping strikt an. 
3. **ID-Mapping:** Wenn das Ziel-Schema z.B. eine 'assignee' ID erwartet und das Quell-Feld 'creator_id' war, MUSST du im 'idMappings' nachschauen, wie die alte Quell-ID zur neuen Ziel-ID übersetzt wurde. Setze IMMER die **neue Ziel-ID** ein!
48  4. **Ziel-Container / Scope:** Wenn ein Objekt in einem Projekt/Space liegen muss, nutze die ID: ${targetScopeId || "NICHT_DEFINIERT"} an der Stelle in URL oder Body, wo die Projekt-ID gefordert wird (häufig als Platzhalter im Schema definiert).
49  5. **WICHTIG (BODY REQUIRED):** Wenn du 'push_mapped_data' aufrufst, MUSST du für POST/PUT-Requests zwingend den Parameter 'body' mit allen gemappten Feldern (insbesondere 'name' bei Ordnern/Listen/Tasks) befüllen. Der Body darf niemals fehlen oder leer sein!

### ZUR VERFÜGUNG STEHENDE DATEN:
**Mapping-Regeln für diese Aufgabe:**
${JSON.stringify(mappingRules.filter(r => r.source_object === task.sourceEntityType && r.target_object === task.targetEntityType), null, 2)}

**Bereits existierende ID-Mappings (für Abhängigkeiten, Format: source_id -> target_id):**
${JSON.stringify(idMappings, null, 2)}

**Quell-System Spezifikation (Auszug für ${task.sourceEntityType}):**
${JSON.stringify(sourceSchema?.objects?.[task.sourceEntityType] || sourceSchema, null, 2)}

**Ziel-System Endpunkte & Logik:**
Endpunkte: ${JSON.stringify(targetSchema?.discovery?.endpoints || {}, null, 2)}
Export-Logik: ${targetSchema?.exportInstructions?.logic || "Keine spezifische Logik."}

**Ziel-System Request-Templates (WICHTIG für Struktur):**
${JSON.stringify(targetSchema?.exportInstructions?.requestTemplates || {}, null, 2)}

**Ziel-System Spezifikation (Auszug für ${task.targetEntityType}):**
${JSON.stringify(targetSchema?.objects?.[task.targetEntityType] || targetSchema, null, 2)}
`;

    const fetchTool: Tool = {
      type: "function",
      function: {
        name: "fetch_source_data",
        description: `Lädt die Quell-Daten für den Entitätstyp '${task.sourceEntityType}' aus der lokalen Graph-Datenbank. TIPP: Die Antwort enthält auch '_relations', worin du z.B. die 'parent_target_id' findest, falls das Elternelement bereits migriert wurde. Nutze diese ID für den Ziel-API-Call (z.B. in der URL).`,
        parameters: {
          type: "object",
          properties: {
            entityType: { type: "string", description: "Der Name der Quell-Entität (z.B. 'status', 'issues')" },
            limit: { type: "number", description: "Max. Anzahl (Standard 10, max 50 für API Limits)." }
          },
          required: ["entityType"]
        }
      }
    };

    const pushTool: Tool = {
      type: "function",
      function: {
        name: "push_mapped_data",
        description: `Führt einen API-Call zum Zielsystem aus, um ein ODER mehrere transformierte Objekte zu erstellen.`,
        parameters: {
          type: "object",
          properties: {
            requests: {
               type: "array",
               description: "Liste der auszuführenden API-Calls.",
               items: {
                  type: "object",
                  properties: {
                    sourceId: { type: "string", description: "Die ID des Objekts aus dem Quellsystem (wichtig für das spätere ID-Mapping)." },
                    method: { type: "string", enum: ["POST", "PUT", "PATCH"], description: "HTTP Methode." },
                    url: { type: "string", description: "Relativer Endpunkt (z.B. '/api/v2/task') oder absolute URL." },
                    body: { type: "object", description: "WICHTIG: Der fertig strukturierte JSON-Payload, den das Zielsystem erwartet. Für POST/PUT zwingend erforderlich (z.B. { 'name': 'Projekt 1' }). Darf nicht leer sein!" }
                  },
                  required: ["sourceId", "method", "url", "body"]
               }
            }
          },
          required: ["requests"]
        }
      }
    };

    const finishTool: Tool = {
      type: "function",
      function: {
        name: "finish_task",
        description: "Beendet den Task und meldet die neu erstellten ID-Mappings an den Orchestrator zurück.",
        parameters: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            newIdMappings: {
              type: "object",
              additionalProperties: { type: "string" },
              description: "Ein Dictionary: { 'quell_id_1': 'ziel_id_1', 'quell_id_2': 'ziel_id_2' }"
            },
            message: { type: "string", description: "Zusammenfassung oder Fehlermeldung" }
          },
          required: ["success", "newIdMappings", "message"]
        }
      }
    };

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: "Lade die Daten mit 'fetch_source_data'. Transformiere sie und sende sie mit 'push_mapped_data'. Rufe danach 'finish_task' mit den neuen ID-Mappings auf." }
    ];

    let newMappings: Record<string, string> = {};
    const logs: string[] = [];
    
    // Safety loop to prevent infinite tool calls within a single subagent run
    const MAX_STEPS = 15;
    for (let step = 0; step < MAX_STEPS; step++) {
      try {
        const response = await this.provider.chat(messages, [fetchTool, pushTool, finishTool], { temperature: 0.1 });

        if (response.content) {
          messages.push({ role: "assistant", content: response.content });
          logs.push(response.content);
        }

        if (response.toolCalls && response.toolCalls.length > 0) {
          messages.push({
             role: "assistant",
             content: null,
             tool_calls: response.toolCalls
          });

          for (const toolCall of response.toolCalls) {
            const args = JSON.parse(toolCall.function.arguments);
            let toolResultStr = "";

            if (toolCall.function.name === 'fetch_source_data') {
               const limit = args.limit || 10;
               logs.push(`[Tool] Fetching source data from Neo4j (limit: ${limit})...`);
               await this.context.logActivity('info', `Lade Daten aus Neo4j (Limit: ${limit})...`);
               
               const driver = neo4j.driver(
                 process.env.NEO4J_URI || "bolt://neo4j-db:7687",
                 neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "password")
               );
               const session = driver.session();
               try {
                   // Only fetch nodes that have NOT been transferred yet
                   const res = await session.run(
                                       `MATCH (n:\`${sourceSystem}\`) 
                                        WHERE n.migration_id = $migrationId 
                                        AND (toLower(n.entity_type) = toLower($entityType) 
                                             OR toLower(n.entity_type) = toLower($entityType) + "s"
                                             OR toLower(n.entity_type) CONTAINS toLower($entityType))
                        AND n.target_id IS NULL
                        OPTIONAL MATCH (n)-[r]->(p) WHERE p.target_id IS NOT NULL
                        RETURN properties(n) as node, collect({type: type(r), parent_target_id: p.target_id}) as relations
                        LIMIT toInteger($limit)`,
                       { 
                          migrationId: this.context.migrationId, 
                          entityType: args.entityType,
                          limit 
                       }
                   );
                   
                   const fetchedData = res.records.map(r => ({
                       ...r.get('node'),
                       _relations: r.get('relations')
                   }));
                   
                   toolResultStr = JSON.stringify({ success: true, count: fetchedData.length, data: fetchedData });
               } catch(dbErr: any) {
                   toolResultStr = JSON.stringify({ error: `Neo4j Query Error: ${dbErr.message}` });
               } finally {
                   await session.close();
                   await driver.close();
               }
            } 
            else if (toolCall.function.name === 'push_mapped_data') {
               logs.push(`[Tool] Pushing ${args.requests.length} mapped items to Target API...`);
               console.log(`[Worker] push_mapped_data args: ${JSON.stringify(args, null, 2)}`);
               await this.context.logActivity('info', `Sende ${args.requests.length} transformierte Elemente an das Zielsystem...`);
               
               // Get Target Connector Info
               const targetConnector = await this.context.getConnector('out');
               if (!targetConnector) {
                   toolResultStr = JSON.stringify({ error: "Target connector not configured or missing." });
               } else {
                   const results = [];
                   const authConf = targetSchema?.authentication;
                   const targetHeaders: any = { 
                       "Accept": "application/json",
                       "Content-Type": "application/json",
                       ...(targetSchema?.headers || {})
                   };

                   const token = targetConnector.api_key || targetConnector.username;
                   if (token) {
                       const prefix = authConf?.tokenPrefix !== undefined ? authConf.tokenPrefix : 'Bearer ';
                       const headerName = authConf?.headerName || 'Authorization';
                       targetHeaders[headerName] = `${prefix}${token.trim()}`;
                   }

                   for (const req of args.requests) {
                       let finalUrl = req.url.startsWith('http') ? req.url : (targetSchema?.apiBaseUrl || "") + req.url;
                       
                       // GENERIC FIX: Replace common URL placeholders with targetScopeId if the LLM didn't do it
                       if (targetScopeId) {
                           const placeholders = ["{team_id}", "{workspace_id}", "{project_id}", "{space_id}", "{list_id}", "{board_id}"];
                           for (const p of placeholders) {
                               if (finalUrl.includes(p)) {
                                   finalUrl = finalUrl.replace(p, targetScopeId);
                                   logs.push(`[Worker] Auto-replaced URL placeholder ${p} with targetScopeId ${targetScopeId}`);
                               }
                           }
                       }

                       // GENERIC FIX: Ensure body is an object for POST/PATCH requests if missing
                       if ((req.method === 'POST' || req.method === 'PATCH') && !req.body) {
                           req.body = {};
                           logs.push(`[Worker] Initialized empty body for ${req.method} request as it was missing.`);
                       }

                       // GENERIC FIX: If the schema defines a parent template and it's missing or incomplete in the POST body, inject it
                       if (req.method === 'POST' && req.body && targetScopeId) {
                           const templates = targetSchema?.exportInstructions?.requestTemplates || {};
                           // Look for any template that defines a parent structure
                           const templateWithParent = Object.values(templates).find((t: any) => t.body_structure?.parent);
                           if (templateWithParent) {
                               const parentTemplate = (templateWithParent as any).body_structure.parent;
                               
                               // Check if parent is completely missing or missing its crucial ID field
                               const needsInjection = !req.body.parent || 
                                                      (parentTemplate.type === 'page_id' && !req.body.parent.page_id) || 
                                                      (parentTemplate.type === 'database_id' && !req.body.parent.database_id);

                               if (needsInjection) {
                                   // Clone and replace placeholder
                                   const injectedParent = JSON.parse(JSON.stringify(parentTemplate).replace("{targetScopeId}", targetScopeId));
                                   req.body.parent = injectedParent;
                                   logs.push(`[Worker] Auto-injected or fixed parent structure from schema template.`);
                               }
                           }
                       }

                       // GENERIC FIX: Automatic Body Repair based on Request Templates
                       // If a template has exactly one root key (e.g. 'children', 'data') and the agent didn't provide it, wrap it.
                       const templates = targetSchema?.exportInstructions?.requestTemplates || {};
                       const matchingTemplate: any = Object.values(templates).find((t: any) => {
                           if (t.method !== req.method) return false;
                           // Simple pattern match: replace {placeholder} with wildcard
                           const pattern = t.url.replace(/\{[^}]+\}/g, '.*');
                           const regex = new RegExp(`^${pattern}$`);
                           return regex.test(req.url);
                       });

                       if (matchingTemplate && matchingTemplate.body_structure) {
                           const rootKeys = Object.keys(matchingTemplate.body_structure);
                           if (rootKeys.length === 1) {
                               const wrapperKey = rootKeys[0];
                               // If the current body doesn't have the wrapper key, and it's either an array or doesn't have other keys from the template
                               if (!req.body[wrapperKey]) {
                                   if (Array.isArray(req.body)) {
                                       req.body = { [wrapperKey]: req.body };
                                       logs.push(`[Worker] Auto-wrapped request body in '${wrapperKey}' (detected from template).`);
                                   } else if (Object.keys(req.body).length > 0) {
                                       // It's an object but missing the root key. 
                                       // Only wrap if it's NOT already containing the keys that SHOULD be inside the wrapper
                                       // (This is a heuristic, but safe for Notion's 'children')
                                       req.body = { [wrapperKey]: [req.body] };
                                       logs.push(`[Worker] Auto-wrapped object body in '${wrapperKey}' array (detected from template).`);
                                   }
                               }
                           }
                       }

                       try {
                           const apiRes = await fetch(finalUrl, {
                               method: req.method,
                               headers: targetHeaders,
                               body: req.method === 'GET' ? undefined : JSON.stringify(req.body)
                           });

                           if (!apiRes.ok) {
                               const errText = await apiRes.text();
                               console.error(`[Worker] API Call failed: ${apiRes.status} - ${errText}`);
                               console.error(`[Worker] API Call URL: ${finalUrl}`);
                               console.error(`[Worker] API Call Body: ${JSON.stringify(req.body, null, 2)}`);
                               await this.context.writeChatMessage('assistant', `⚠️ API-Call fehlgeschlagen: **${apiRes.status}** beim Übertragen von Objekt ${req.sourceId}. Details: ${errText.substring(0, 100)}...`, this.context.stepNumber);
                               results.push({ sourceId: req.sourceId, success: false, status: apiRes.status, error: errText });
                           } else {
                               const apiData = await apiRes.json();
                               
                               // GENERIC ID EXTRACTION: Try paths from schema or defaults
                               let newTargetId: string | null = null;
                               const extractionPaths = targetSchema?.exportInstructions?.idExtractionPaths || [
                                   "id", "gid", "key", "data.id", "data.gid"
                               ];

                               for (const path of extractionPaths) {
                                   // Simple path resolver (e.g. "results[0].id" or "data.id")
                                   try {
                                       const parts = path.split('.');
                                       let current: any = apiData;
                                       for (const part of parts) {
                                           if (current === undefined || current === null) break;
                                           if (part.includes('[') && part.includes(']')) {
                                               const [key, indexPart] = part.split('[');
                                               const index = parseInt(indexPart.replace(']', ''));
                                               current = current[key]?.[index];
                                           } else {
                                               current = current[part];
                                           }
                                       }
                                       if (current && typeof current === 'string') {
                                           newTargetId = current;
                                           if (path !== extractionPaths[0]) {
                                               logs.push(`[Worker] Extracted ID ${newTargetId} using path '${path}'.`);
                                           }
                                           break;
                                       }
                                   } catch (e) { /* skip path */ }
                               }
                               
                               if (newTargetId) {
                                  newMappings[req.sourceId] = String(newTargetId);
                                  
                                  // Update Neo4j to mark as transferred
                                  const driver = neo4j.driver(process.env.NEO4J_URI || "bolt://neo4j-db:7687", neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "password"));
                                  const session = driver.session();
                                  try {
                                      await session.run(
                                          `MATCH (n:\`${sourceSystem}\` { migration_id: $migrationId, external_id: $extId }) 
                                           SET n.target_id = $targetId`,
                                          { migrationId: this.context.migrationId, extId: String(req.sourceId), targetId: String(newTargetId) }
                                      );
                                  } finally {
                                      await session.close();
                                      await driver.close();
                                  }

                                  results.push({ sourceId: req.sourceId, success: true, newTargetId: String(newTargetId) });
                               } else {
                                  results.push({ sourceId: req.sourceId, success: false, error: "API succeeded but no standard ID field found in response." });
                               }
                           }
                       } catch (fetchErr: any) {
                           results.push({ sourceId: req.sourceId, success: false, error: fetchErr.message });
                       }
                   }
                   toolResultStr = JSON.stringify({ results });
               }
            }
            else if (toolCall.function.name === 'finish_task') {
               logs.push(`[Tool] Task finished: ${args.message}`);
               if (args.success) {
                  return {
                     success: true,
                     newMappings: { ...newMappings, ...args.newIdMappings },
                     logs
                  };
               } else {
                  return {
                     success: false,
                     newMappings: newMappings,
                     error: args.message,
                     logs
                  };
               }
            } else {
               toolResultStr = JSON.stringify({ error: `Unknown tool: ${toolCall.function.name}` });
            }

            messages.push({
               role: "tool",
               tool_call_id: toolCall.id,
               name: toolCall.function.name,
               content: toolResultStr
            });
          }
        } else {
          messages.push({
            role: "user",
            content: "Du hast keine Tools aufgerufen. Bitte nutze 'fetch_source_data', dann 'push_mapped_data' und beende mit 'finish_task', wenn du alle geladenen Objekte verarbeitet hast."
          });
        }
      } catch (error: any) {
         logs.push(`Error during execution: ${error.message}`);
         return { success: false, newMappings: newMappings, error: error.message, logs };
      }
    }

    return {
       success: false,
       newMappings: newMappings,
       error: "Task failed: Exceeded maximum internal steps without calling finish_task.",
       logs
    };
  }
}
