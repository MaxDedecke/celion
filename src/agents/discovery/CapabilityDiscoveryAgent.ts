import { AgentBase, AgentContext } from '../core/AgentBase';
import { LlmProvider, Tool, ChatMessage } from '../core/LlmProvider';
import { loadScheme, loadObjectScheme } from '../../lib/scheme-loader';
import { smartDiscovery } from '../../tools/smartDiscovery';

export class CapabilityDiscoveryAgent extends AgentBase {
  async execute(params: any): Promise<any> {
    const { migrationId, stepNumber } = this.context;
    const sourceUrl = params?.sourceUrl;
    const sourceSystem = params?.sourceExpectedSystem;

    await this.context.writeChatMessage('assistant', "Starte **Source Discovery**", stepNumber);
    
    const migrationDetails = await this.context.getMigrationDetails();
    const scopeConfig = migrationDetails?.scope_config || {};
    const connector = await this.context.getConnector('in');

    if (!connector || (!connector.api_key && !connector.username)) {
      const failureMessage = `Keine Zugangsdaten für das Quellsystem gefunden.`;
      return { success: false, error: failureMessage, isLogicalFailure: true };
    }

    const fullScheme = await loadScheme(sourceSystem);
    const discoveryScheme = { ...(fullScheme || {}), apiBaseUrl: fullScheme?.apiBaseUrl, headers: fullScheme?.headers };
    
    const scopeName = scopeConfig?.sourceScope || "Alles";
    const scopeIds = scopeConfig?.sourceScopeIds || [];
    
    const detailMsg = `Fokussiere Discovery auf Bereich: **${scopeName}**${scopeIds.length > 0 ? ` (ID: ${scopeIds.join(', ')})` : ''}.`;
    await this.context.writeChatMessage('assistant', detailMsg, stepNumber);

    const email = connector.username || "";
    const token = connector.api_key || "";
    const base64Credentials = btoa(`${email}:${token}`);
    const endpointKeys = Object.keys(discoveryScheme?.discovery?.endpoints || {});

    // --- Phase 1: Planning Agent ---
    await this.context.writeChatMessage('assistant', 'Phase 1: Erstelle Discovery-Plan...', stepNumber);
    
    const planningPrompt = `
Du bist der Planning Agent für eine Datenmigration.
Deine Aufgabe ist es, einen sequentiellen Ausführungsplan für API-Aufrufe zu erstellen, um alle relevanten Daten für den ausgewählten Scope zu ermitteln.

### API BASE URL:
${discoveryScheme?.apiBaseUrl || "Nicht definiert"}

### SYSTEM SCHEMA (Verfügbare Endpunkte):
${JSON.stringify(discoveryScheme?.discovery?.endpoints || {}, null, 2)}

### NAVIGATION GUIDE:
${JSON.stringify(discoveryScheme?.navigationGuide || "Kein Guide vorhanden.", null, 2)}

### SCOPE:
Name: ${scopeName}
IDs: ${JSON.stringify(scopeIds)}

### AUFGABE:
1. Analysiere die 'endpoints' und den 'navigationGuide'.
2. Bestimme, welche Endpunkte aufgerufen werden müssen, um die Datenmengen (Counts) der verschiedenen Entitäten (z.B. Projekte, Tasks, Listen) zu ermitteln.
3. Berücksichtige den 'Scope':
   - Wenn IDs übergeben wurden, MÜSSEN diese im Plan verwendet werden, um API-Platzhalter (wie {space_id}, {project_id} etc.) zu füllen oder sie als Kontext für den nächsten Schritt zu definieren.
   - Der Plan MUSS die logische Reihenfolge einhalten (z.B. erst Ordner abfragen, dann Listen in diesen Ordnern).
4. Erstelle einen JSON-Plan mit einer Liste von Schritten.

### JSON OUTPUT FORMAT:
{
  "summary": "Kurze Erklärung des Plans",
  "plan": [
    {
      "step": number,
      "endpoint_key": "string (Schlüssel aus den endpoints)",
      "url_template": "string (Die URL mit Platzhaltern)",
      "description": "string (Was macht dieser Schritt?)",
      "requires_ids": ["string"] (Platzhalter-Namen, die für diese URL benötigt werden, z.B. "space_id")
    }
  ]
}
    `;

    const planningResponse = await this.provider.chat([
        { role: "system", content: "Du bist ein API Planning Agent." },
        { role: "user", content: planningPrompt }
    ], undefined, { response_format: { type: "json_object" } });

    let executionPlan: any = null;
    try {
        if (planningResponse.content) {
            executionPlan = JSON.parse(planningResponse.content);
            await this.context.writeChatMessage('assistant', `Plan erstellt: ${executionPlan.summary}`, stepNumber);
        }
    } catch (e) {
        return { success: false, error: "Planung fehlgeschlagen (ungültiges JSON)", isLogicalFailure: true };
    }

    if (!executionPlan || !executionPlan.plan || executionPlan.plan.length === 0) {
        return { success: false, error: "Leerer Ausführungsplan generiert.", isLogicalFailure: true };
    }

    // --- Phase 2: Execution Agent ---
    await this.context.writeChatMessage('assistant', 'Phase 2: Führe Discovery-Plan aus...', stepNumber);

    const executionPrompt = `
Du bist der Execution Agent für eine Datenmigration.
Deine Aufgabe ist es, den übergebenen 'Execution Plan' SCHRITT FÜR SCHRITT abzuarbeiten und dabei das Tool 'smart_discovery' zu verwenden.

### API BASE URL:
${discoveryScheme?.apiBaseUrl || "Nicht definiert"}

### DEIN PLAN:
${JSON.stringify(executionPlan.plan, null, 2)}

### BEKANNTE SCOPE IDs (VOM USER GEWÄHLT):
Wenn in URLs Platzhalter (wie {space_id}, {team_id}, {workspace_id}) vorkommen, MUSST du versuchen, diese mit den folgenden IDs zu ersetzen, falls zutreffend:
Name des Scopes: ${scopeName}
IDs: ${JSON.stringify(scopeIds)}

### REGELN FÜR DIE AUSFÜHRUNG:
1. Arbeite den Plan sequentiell ab.
2. Für JEDEN Schritt im Plan MUSST du das Tool 'smart_discovery' mit einer VOLLSTÄNDIG aufgelösten URL (KEINE geschweiften Klammern!) aufrufen.
3. Wenn ein Schritt IDs benötigt (z.B. {folder_id}), die du nicht in den 'BEKANNTE SCOPE IDs' hast, MUSST du diese aus den API-Antworten der VORHERIGEN Schritte extrahieren. Rufe das Tool dann ggf. in einer Schleife (oder mehrfach) für alle gefundenen IDs auf.
4. Generiere NIEMALS Fake-IDs.
5. Führe für jeden relevanten Endpunkt aus dem Plan Tool-Calls aus.

### FINAL JSON FORMAT:
Sobald alle Schritte ausgeführt und alle Daten gesammelt wurden, antworte mit folgendem JSON:
{
  "entities": [
    { "name": "string (z.B. tasks, lists)", "count": number (Echter totalCount aus der API), "complexity": "low" | "medium" | "high" }
  ],
  "coverage": {
    "totalEndpoints": number,
    "checkedEndpoints": ["string"],
    "missedEndpoints": [{ "name": "string", "reason": "string" }]
  },
  "estimatedDurationMinutes": number,
  "complexityScore": number (1-10),
  "executedCalls": ["string"],
  "summary": "Zusammenfassung der Ausführung"
}

### KOMPLEXITÄTS-BEWERTUNG (complexityScore):
- 1-3: < 5.000 Elemente gesamt.
- 4-7: 5.000 - 50.000 Elemente gesamt.
- 8-10: > 50.000 Elemente gesamt.
    `;

    const TOOLS: Tool[] = [
      {
        type: "function",
        function: {
          name: "smart_discovery",
          description: "Führt eine Discovery-Anfrage durch. URL MUSS vollständig sein (keine Platzhalter).",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string" },
              method: { type: "string", enum: ["GET", "POST"] }
            },
            required: ["url"]
          }
        }
      }
    ];

    let messages: ChatMessage[] = [
        { role: "system", content: "Du bist ein präziser API Execution Agent." },
        { role: "user", content: executionPrompt }
    ];

    let phase2Result: any = null;

    for (let turn = 0; turn < 25; turn++) {
         const response = await this.provider.chat(messages, TOOLS, { response_format: { type: "json_object" } });
         const message: ChatMessage = {
             role: 'assistant',
             content: response.content,
             tool_calls: response.toolCalls
         };
         messages.push(message);

         if (message.content) {
             if (message.content.trim().startsWith('{')) {
                 try {
                     phase2Result = JSON.parse(message.content);
                     if (phase2Result.entities) {
                         break; 
                     }
                 } catch (e) {
                 }
             }
         }

         if (message.tool_calls && message.tool_calls.length > 0) {
             for (const toolCall of message.tool_calls) {
                 const functionName = toolCall.function.name;
                 const args = JSON.parse(toolCall.function.arguments);
                 let toolResult: any;

                 if (functionName === 'smart_discovery') {
                     toolResult = await this.handleSmartDiscoveryToolCall(args, token, base64Credentials, discoveryScheme);
                 } else {
                     toolResult = { error: `Unknown tool: ${functionName}` };
                 }

                 messages.push({
                     tool_call_id: toolCall.id,
                     role: "tool",
                     name: functionName,
                     content: JSON.stringify(toolResult)
                 });
             }
         } else {
             break;
         }
    }

    if (!phase2Result || !phase2Result.entities) {
         return { success: false, error: "Ausführung fehlgeschlagen oder kein gültiges Ergebnis geliefert.", isLogicalFailure: true };
    }

    // --- Phase 3: Inventory Normalization ---
    try {
        const sourceObjectSpecs = await loadObjectScheme(sourceSystem);
        if (sourceObjectSpecs && phase2Result.entities && phase2Result.entities.length > 0) {
            await this.context.writeChatMessage('assistant', 'Phase 3: Normalisierung der Inventar-Daten...', stepNumber);
            
            const normalizationPrompt = `
            Du bist ein Data Normalization Agent. Dein Ziel ist es, ein rohes System-Inventar auf standardisierte Objekt-Keys zu bereinigen.

            ### RAW INVENTORY:
            ${JSON.stringify(phase2Result.entities)}

            ### TARGET OBJECT KEYS (aus der technischen Spezifikation):
            ${JSON.stringify(sourceObjectSpecs.objects.map((o: any) => ({ key: o.key, displayName: o.displayName })))}

            ### SCOPE KONFIGURATION:
            ${JSON.stringify(scopeConfig)}

            ### AUFGABE:
            1. Analysiere jedes Item im 'Raw Inventory'.
            2. Ordne es dem passendsten 'key' aus den 'Target Object Keys' zu. (Beispiel: 'project_tasks' -> 'task', 'sections' -> 'section').
            3. Führe Duplikate zusammen (Summiere die 'count' Werte).
            4. Falls ein Item zu absolut keinem technischen Key passt, behalte es unter seinem ursprünglichen Namen bei.

            ### OUTPUT FORMAT:
            {
              "entities": [
                { "name": "technical_key", "count": number, "complexity": "low|medium|high" }
              ],
              "normalization_summary": "Kurze Beschreibung was zusammengeführt wurde."
            }
            `;

            const normResponse = await this.provider.chat([
                { role: "system", content: "Du bist ein Experte für Daten-Strukturen." },
                { role: "user", content: normalizationPrompt }
            ], undefined, { response_format: { type: "json_object" } });

            if (normResponse.content) {
                const normResult = JSON.parse(normResponse.content);
                if (normResult.entities) {
                    phase2Result.raw_entities_pre_normalization = [...phase2Result.entities];
                    phase2Result.entities = normResult.entities;
                    phase2Result.normalization_summary = normResult.normalization_summary;
                    await this.context.writeChatMessage('assistant', `Inventar bereinigt: ${normResult.normalization_summary}`, stepNumber);
                }
            }
        }
    } catch (normErr: any) {
        console.error(`[CapabilityDiscoveryAgent] Normalization failed:`, normErr);
    }

    const result = phase2Result;

    if (!result || result.error || (!result.entities || result.entities.length === 0)) {
        return {
            success: false,
            error: result?.error || "Keine Daten zur Migration gefunden (Discovery leer).",
            isLogicalFailure: true,
            result
        };
    }

    return {
        success: true,
        result
    };
  }

  private async handleSmartDiscoveryToolCall(args: any, token: string, base64Credentials: string, discoveryScheme: any): Promise<any> {
      const requestHeaders: Record<string, string> = {};

      const isGenericId = (url: string) => {
        return /123456789/.test(url) || /23456789/.test(url) || /34567890/.test(url) || /987654321/.test(url);
      };

      if (!args.url) {
        return { error: "Keine URL für smart_discovery angegeben." };
      }

      let finalUrl = args.url;
      // Prepend apiBaseUrl if it's a relative URL
      if (!finalUrl.startsWith('http') && discoveryScheme?.apiBaseUrl) {
          const baseUrl = discoveryScheme.apiBaseUrl.replace(/\/$/, '');
          const path = finalUrl.startsWith('/') ? finalUrl : `/${finalUrl}`;
          finalUrl = `${baseUrl}${path}`;
      }

      if (finalUrl && (finalUrl.includes('{') || finalUrl.includes('}'))) {
        return { 
            error: `URL enthält noch unaufgelöste Platzhalter: ${finalUrl}. Ersetze diese durch reale IDs.` 
        };
      } else if (finalUrl && isGenericId(finalUrl)) {
        return {
            error: `URL enthält eine Dummy-ID: ${finalUrl}. Nutze reale IDs.`
        };
      } else {
        const auth = discoveryScheme?.authentication;
        
        if (auth) {
            if (auth.type === 'bearer') {
                const prefix = auth.tokenPrefix !== undefined ? auth.tokenPrefix : 'Bearer ';
                requestHeaders['Authorization'] = `${prefix}${token}`;
            } else if (auth.type === 'header') {
                const name = auth.headerName || 'Authorization';
                const prefix = auth.tokenPrefix !== undefined ? auth.tokenPrefix : '';
                requestHeaders[name] = `${prefix}${token}`;
            } else if (auth.type === 'basic') {
                requestHeaders['Authorization'] = `Basic ${base64Credentials}`;
            }
        }
        
        if (discoveryScheme?.headers) {
            Object.assign(requestHeaders, discoveryScheme.headers);
        }

        try {
          const toolResult = await smartDiscovery({
              url: finalUrl,
              method: args.method || 'GET',
              headers: requestHeaders,
              paginationConfig: discoveryScheme?.discovery?.pagination
          });

          if (toolResult.sampleData) {
              const sampleStr = JSON.stringify(toolResult.sampleData);
              if (sampleStr.length > 5000) {
                  toolResult.sampleData = sampleStr.slice(0, 5000) + '...[TRUNCATED]';
              }
          }
          return toolResult;
        } catch (toolErr: any) {
          return { error: toolErr.message };
        }
      }
  }
}
