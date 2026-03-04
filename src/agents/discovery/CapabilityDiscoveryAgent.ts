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
    const migrationContext = migrationDetails?.context || {};
    const connector = await this.context.getConnector('in');

    if (!connector || (!connector.api_key && !connector.username)) {
      const failureMessage = `Keine Zugangsdaten für das Quellsystem gefunden.`;
      return { success: false, error: failureMessage, isLogicalFailure: true };
    }

    const fullScheme = await loadScheme(sourceSystem);
    const discoveryScheme = { ...(fullScheme || {}), apiBaseUrl: fullScheme?.apiBaseUrl, headers: fullScheme?.headers };
    
    const detailMsg = `Ich analysiere die Struktur von **${sourceSystem}** und ermittle die Datenmengen${scopeConfig?.sourceScope ? ` (Fokus: **${scopeConfig.sourceScope}**)` : ''}.`;
    await this.context.writeChatMessage('assistant', detailMsg, stepNumber);

    // --- Phase 1: Exploration ---
    await this.context.writeChatMessage('assistant', 'Phase 1: Exploration der API-Endpunkte...', stepNumber);
    
    const email = connector.username || "";
    const token = connector.api_key || "";
    const base64Credentials = btoa(`${email}:${token}`);
    const endpointKeys = Object.keys(discoveryScheme?.discovery?.endpoints || {});

    const SYSTEM_PROMPT = `
Du bist eine Data Discovery Engine. Dein Ziel ist eine vollständige und wahrheitsgetreue Bestandsaufnahme der Systemstruktur und der Datenmengen.

### MIGRATIONS-GEDÄCHTNIS (WICHTIG!):
Nutze diese bereits verifizierten Fakten über die Migration, um Zeit zu sparen und Halluzinationen zu vermeiden.
${JSON.stringify(migrationContext, null, 2)}

### PHASE 0: SCOPE ALIGNMENT (Identifizierung via API)
- **ZIELE IDENTIFIZIEREN:** Falls in der Konfiguration (scopeConfig) ein Projektname (sourceScope) angegeben ist, musst du ZUERST die zugehörige ID (gid, id, uuid) über einen API-Call (z.B. /projects oder /workspaces) finden.
- **ALLES ERFASSEN:** Falls KEIN Projektname angegeben ist, liste alle verfügbaren Container (Workspaces, Teams, Spaces) über die API auf und erfasse deren IDs.
- **KEINE FAKE-IDS:** Nutze NIEMALS generische IDs wie '123456789', '23456789' oder '123'. Wenn du keine echte ID über die API findest, STOPPE und melde einen Fehler.
- **ID-CACHING:** Speichere die verifizierten IDs intern ab. Du darfst für alle weiteren API-Aufrufe NUR noch diese über die API ermittelten IDs verwenden.

### PHASE 1: EXPLORATION (Tool use)
- **BEWEISPFLICHT:** Jeder 'count' im finalen Bericht MUSS auf einem realen 'totalCount' aus einem 'smart_discovery' Tool-Call basieren. Halluziniere NIEMALS Datenmengen.
- **STRIKTE REGEL: KEINE PLATZHALTER.** Nutze NIEMALS URLs mit geschweiften Klammern. Ersetze diese durch die in Phase 0 identifizierten IDs.
- **VOLLSTÄNDIGE ZÄHLUNG:** Rufe 'smart_discovery' für jeden Endpunkt auf. 

### PHASE 2: FINAL REPORT
- Erstelle das JSON-Objekt NUR mit Daten, die du tatsächlich über Tools abgefragt hast.
- Falls ein Endpunkt nicht abgefragt werden konnte, setze den Count auf 0 und dokumentiere dies unter 'missedEndpoints'.

### KOMPLEXITÄTS-BEWERTUNG:
1. **Entitäts-Ebene:** 
   - 0 Elemente -> IMMER "low"
   - < 1.000 Elemente -> "low"
   - 1.000 - 10.000 -> "medium"
   - > 10.000 -> "high"
2. **Gesamt-Score (complexityScore):** Gib einen Wert zwischen 1 und 10 an (NIEMALS höher!).
   - 1-3 (Low): < 5.000 Elemente gesamt.
   - 4-7 (Medium): 5.000 - 50.000 Elemente gesamt.
   - 8-10 (High/Critical): > 50.000 Elemente gesamt.

### FINAL JSON FORMAT:
{
  "entities": [
    { "name": "string", "count": number, "complexity": "low" | "medium" | "high" }
  ],
  "coverage": {
    "totalEndpoints": number,
    "checkedEndpoints": ["string"],
    "missedEndpoints": [{ "name": "string", "reason": "string" }]
  },
  "estimatedDurationMinutes": number,
  "complexityScore": number,
  "executedCalls": ["string"],
  "scope": { 
    "identified": boolean, 
    "name": string | null, 
    "id": string | null, 
    "type": string | null,
    "identified_ids": {
       "workspace_id": "string",
       "project_id": "string",
       "space_id": "string",
       "team_id": "string",
       "other_ids": {}
    }
  },
  "summary": "Kurze deutsche Zusammenfassung.",
  "rawOutput": "Technischer Bericht."
}
    `;

    const TOOLS: Tool[] = [
      {
        type: "function",
        function: {
          name: "smart_discovery",
          description: "Führt eine intelligente Discovery-Anfrage durch. WICHTIG: Die URL muss vollständig aufgelöst sein (KEINE geschweiften Klammern!).",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "Die VOLLSTÄNDIGE URL (inkl. Base URL und ECHTEN IDs statt Platzhaltern)." },
              method: { type: "string", enum: ["GET", "POST"], description: "HTTP Methode." },
              headers: { type: "object", description: "Header (Authentifizierung wird automatisch ergänzt)." },
              body: { type: "object", description: "Optionaler Body." }
            },
            required: ["url"]
          }
        }
      }
    ];

    const userContext = `
Source URL: ${sourceUrl}
Credentials: ${connector.username ? 'Email provided' : 'No email'}, Token provided
Scope Config: ${JSON.stringify(scopeConfig || {}, null, 2)}

### NAVIGATION GUIDE (Strikte Befolgung erforderlich):
${JSON.stringify(discoveryScheme?.navigationGuide || "Kein Guide vorhanden.", null, 2)}

### SYSTEM SCHEME:
${JSON.stringify(discoveryScheme, null, 2)}

### REQUIRED ENDPOINTS TO CHECK:
${endpointKeys.map(k => `- ${k}`).join('\\n')}

Du MUSST für JEDEN dieser Endpunkte im finalen Report unter 'coverage' angeben, ob er geprüft wurde oder warum er übersprungen wurde. Nutze zwingend den Navigation Guide für die Identifizierung der IDs.
    `;

    let messages: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContext }
    ];

    let phase1Result: any = null;

    // Loop for Phase 1
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
                     phase1Result = JSON.parse(message.content);
                     if (phase1Result.entities) {
                         break; 
                     }
                 } catch (e) {
                 }
             } else {
                 await this.context.writeChatMessage('assistant', message.content, stepNumber);
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
    
    // --- Phase 2: Validation ---
    await this.context.writeChatMessage('assistant', 'Phase 2: Validierung der Abdeckung...', stepNumber);
    
    let validationResult: any = null;
    if (phase1Result) {
        const checkedEndpoints = phase1Result.coverage?.checkedEndpoints || [];
        const validationPrompt = `
        Du bist der Quality Assurance Agent. Überprüfe das Ergebnis der Discovery Phase.
        
        REQUIRED ENDPOINTS:
        ${endpointKeys.join(', ')}
        
        CHECKED ENDPOINTS (from Phase 1 Report):
        ${JSON.stringify(checkedEndpoints)}
        
        MISSED ACCORDING TO REPORT:
        ${JSON.stringify(phase1Result.coverage?.missedEndpoints || [])}
        
        AUFGABE:
        Analysiere, ob die Abdeckung ausreichend ist. 
        Antworte mit einem JSON Objekt:
        {
            "is_sufficient": boolean,
            "missing_critical_endpoints": ["string"],
            "validation_message": "string"
        }
        `;
        
        const validationResponse = await this.provider.chat([
            { role: "system", content: "Du bist ein strenger QA Agent." },
            { role: "user", content: validationPrompt }
        ], undefined, { response_format: { type: "json_object" } });
        
        const valContent = validationResponse.content;
        if (valContent) {
            validationResult = JSON.parse(valContent);
            await this.context.writeChatMessage('assistant', `Validierungsergebnis: ${validationResult.validation_message}`, stepNumber);
        }
    }

    // --- Phase 3: Retry / Gap Filling ---
    if (validationResult && !validationResult.is_sufficient && phase1Result) {
         await this.context.writeChatMessage('assistant', 'Phase 3: Versuche, fehlende Endpunkte abzurufen...', stepNumber);
         
         const phase3Prompt = `
         ### QA VALIDATION FAILED
         The following endpoints were missed: ${JSON.stringify(validationResult.missing_critical_endpoints || [])}
         Validation Message: ${validationResult.validation_message}
         
         ### INSTRUCTION
         1. Use the IDs and data you found in Phase 1 to construct valid URLs for these missing endpoints.
         2. Fetch them using 'smart_discovery'.
         3. Update your findings and provide a NEW, MERGED final report (JSON).
         `;
         
         messages.push({ role: "user", content: phase3Prompt });
         
         for (let turn = 0; turn < 15; turn++) {
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
                         const newResult = JSON.parse(message.content);
                         if (newResult.entities) {
                             phase1Result = newResult;
                             phase1Result.validation = validationResult;
                             phase1Result.phase3_executed = true;
                             await this.context.writeChatMessage('assistant', 'Phase 3 abgeschlossen. Bericht aktualisiert.', stepNumber);
                             break; 
                         }
                     } catch (e) { }
                 } else {
                    await this.context.writeChatMessage('assistant', message.content, stepNumber);
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
    } else {
        await this.context.writeChatMessage('assistant', 'Phase 3: Keine kritischen Lücken gefunden. Überspringe Retry.', stepNumber);
    }

    // --- Phase 4: Inventory Normalization ---
    try {
        const sourceObjectSpecs = await loadObjectScheme(sourceSystem);
        if (sourceObjectSpecs && phase1Result.entities && phase1Result.entities.length > 0) {
            await this.context.writeChatMessage('assistant', 'Phase 4: Normalisierung der Inventar-Daten...', stepNumber);
            
            const normalizationPrompt = `
            Du bist ein Data Normalization Agent. Dein Ziel ist es, ein rohes System-Inventar auf standardisierte Objekt-Keys zu bereinigen.

            ### RAW INVENTORY:
            ${JSON.stringify(phase1Result.entities)}

            ### TARGET OBJECT KEYS (aus der technischen Spezifikation):
            ${JSON.stringify(sourceObjectSpecs.objects.map((o: any) => ({ key: o.key, displayName: o.displayName })))}

            ### SCOPE KONFIGURATION:
            ${JSON.stringify(scopeConfig)}

            ### AUFGABE:
            1. Analysiere jedes Item im 'Raw Inventory'.
            2. Ordne es dem passendsten 'key' aus den 'Target Object Keys' zu. (Beispiel: 'project_tasks' -> 'task', 'sections' -> 'section').
            3. **INTELLIGENTE ZUSAMMENFÜHRUNG & SCOPE-BEWERTUNG:**
               - Falls ein spezifischer **SCOPE** (z.B. ein Projektname oder eine ID) in der 'Scope Konfiguration' definiert ist: Bevorzuge die Counts von Endpunkten, die spezifisch für diesen Scope klingen (z.B. 'project_tasks', 'folder_items'). Ignoriere in diesem Fall die höheren Counts von globalen/unspezifischen Endpunkten (z.B. 'all_tasks'), da diese über den gewählten Scope hinausgehen.
               - Falls **KEIN SCOPE** definiert ist (globale Migration): Nimm bei Redundanz den **MAXIMALWERT**, um alle verfügbaren Daten zu erfassen.
               - Bei komplementären Daten (z.B. 'Active' + 'Archived'): **ADDIERE** die Counts weiterhin.
            4. Falls ein Item zu absolut keinem technischen Key passt, behalte es unter seinem ursprünglichen Namen bei (als Fallback).
            5. Entferne Duplikate durch die Zusammenführung.

            ### REGELN:
            - Antworte AUSSCHLIESSLICH mit dem bereinigten JSON.
            - Behalte die Felder 'count' und 'complexity' bei (wobei 'complexity' das Maximum der zusammengeführten Items sein sollte).

            ### OUTPUT FORMAT:
            {
              "entities": [
                { "name": "technical_key", "count": number, "complexity": "low|medium|high" }
              ],
              "normalization_summary": "Kurze Beschreibung was zusammengeführt wurde (z.B. 'project_tasks wurde mit task zusammengeführt')."
            }
            `;

            const normResponse = await this.provider.chat([
                { role: "system", content: "Du bist ein Experte für Daten-Strukturen." },
                { role: "user", content: normalizationPrompt }
            ], undefined, { response_format: { type: "json_object" } });

            const normContent = normResponse.content;
            if (normContent) {
                const normResult = JSON.parse(normContent);
                if (normResult.entities) {
                    phase1Result.raw_entities_pre_normalization = [...phase1Result.entities];
                    phase1Result.entities = normResult.entities;
                    phase1Result.normalization_summary = normResult.normalization_summary;
                    await this.context.writeChatMessage('assistant', `Inventar bereinigt: ${normResult.normalization_summary}`, stepNumber);
                }
            }
        }
    } catch (normErr: any) {
        console.error(`[CapabilityDiscoveryAgent] Normalization failed:`, normErr);
    }

    const result = phase1Result;

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
      const requestHeaders: Record<string, string> = { ...args.headers };

      const isGenericId = (url: string) => {
        return /123456789/.test(url) || /23456789/.test(url) || /34567890/.test(url) || /987654321/.test(url);
      };

      if (args.url && (args.url.includes('{') || args.url.includes('}'))) {
        return { 
            error: `URL enthält noch unaufgelöste Platzhalter: ${args.url}. Du MUSST diese Platzhalter durch reale IDs aus vorherigen API-Antworten ersetzen, bevor du das Tool aufrufst.` 
        };
      } else if (args.url && isGenericId(args.url)) {
        return {
            error: `URL enthält eine offensichtlich halluzinierte Dummy-ID: ${args.url}. Du darfst KEINE Fake-IDs wie '12345...' verwenden. Ermittle die echten IDs schrittweise über API-Abfragen in Phase 0 (z.B. indem du erst Workspaces/Teams auflistest).`
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
              url: args.url,
              method: args.method || 'GET',
              headers: requestHeaders,
              body: args.body,
              paginationConfig: discoveryScheme?.discovery?.pagination
          });

          if (toolResult.sampleData) {
              const sampleStr = JSON.stringify(toolResult.sampleData);
              if (sampleStr.length > 10000) {
                  toolResult.sampleData = sampleStr.slice(0, 10000) + '...[TRUNCATED]';
              }
          }
          return toolResult;
        } catch (toolErr: any) {
          return { error: toolErr.message };
        }
      }
  }
}
