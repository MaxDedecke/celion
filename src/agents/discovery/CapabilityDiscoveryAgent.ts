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
    const availableEndpoints = discoveryScheme?.discovery?.endpoints || {};
    const endpointKeys = Object.keys(availableEndpoints);

    // --- Phase 1: Planning & Verification Agent ---
    await this.context.writeChatMessage('assistant', 'Phase 1: Erstelle und verifiziere Discovery-Plan...', stepNumber);
    
    const planningPrompt = `
Du bist der Planning Agent für eine Datenmigration.
Deine Aufgabe ist es, einen sequentiellen Ausführungsplan für API-Aufrufe zu erstellen, um ein vollständiges Inventar der Datenmengen (Counts für Tasks, Listen, Projekte etc.) für den ausgewählten Scope zu ermitteln.

### API BASE URL:
${discoveryScheme?.apiBaseUrl || "Nicht definiert"}

### SYSTEM SCHEMA (Verfügbare Endpunkte):
${JSON.stringify(availableEndpoints, null, 2)}

### NAVIGATION GUIDE (WICHTIG - BITTE BEFOLGEN):
${JSON.stringify(discoveryScheme?.navigationGuide || "Kein Guide vorhanden.", null, 2)}

### SCOPE:
Name: ${scopeName}
IDs: ${JSON.stringify(scopeIds)}

### AUFGABE:
1. Analysiere die 'endpoints' und den 'navigationGuide'.
2. Bestimme, welche Endpunkte aufgerufen werden müssen, um die Datenmengen der verschiedenen Entitäten zu ermitteln.
3. Berücksichtige den 'Scope':
   - Nutze die vorhandenen IDs (${JSON.stringify(scopeIds)}), um API-Platzhalter zu füllen.
   - Falls eine 'team_id' oder ähnliche Root-ID benötigt wird, plane zuerst einen Aufruf ein, um diese zu ermitteln (siehe Navigation Guide).
   - Der Plan MUSS die logische Hierarchie einhalten.
   - **WICHTIG:** Wenn der Nutzer einen spezifischen Scope gewählt hat (nicht 'Alles'), dann MUSST du Endpunkte bevorzugen, die sich auf diesen Scope beziehen (z.B. '/projects/{project_id}/tasks' statt des globalen '/tasks'). Ein globaler Endpunkt wie 'tasks' würde zu viele irrelevante Daten erfassen und darf bei einem spezifischen Scope NICHT verwendet werden, es sei denn, es gibt keine andere Möglichkeit.
   - **WICHTIG:** Benenne die Entitäten in deinem Plan exakt so, wie sie in den Endpunkten heißen (z.B. nutze 'project_tasks' anstatt sie zu 'tasks' umzubenennen).
4. Erstelle einen Plan im JSON-Format.

### JSON OUTPUT FORMAT:
{
  "summary": "Kurze Erklärung des Plans",
  "plan": [
    {
      "step": number,
      "endpoint_key": "string (Schlüssel aus den endpoints)",
      "url_template": "string (Die URL mit Platzhaltern)",
      "description": "string",
      "requires_ids": ["string"]
    }
  ]
}
    `;

    const verificationPrompt = `
Du bist der Plan-Verifizierer. Prüfe den folgenden Discovery-Plan gegen die verfügbaren Endpunkte und den Scope.
Ziel ist es, sicherzustellen, dass alle RELEVANTEN Datenmengen (Counts) für den gewählten Scope erfasst werden können.

### VERFÜGBARE ENDPUNKTE:
${endpointKeys.join(', ')}

### GEWÄHLTER SCOPE:
Name: ${scopeName}
IDs: ${JSON.stringify(scopeIds)}

### VORLÄUFIGER PLAN:
{{PLAN}}

### PRÜF-KRITERIEN:
1. **Erreichbarkeit:** Sind alle notwendigen Aufrufe enthalten, um die für den Scope benötigten IDs (z.B. team_id) zu erhalten?
2. **Vollständigkeit:** Werden die Haupt-Datenobjekte (z.B. Tasks, Projekte, Listen) gezählt? (Low-Level Objekte wie Kommentare oder Anhänge sind für das Inventar OPTIONAL und kein Grund zur Ablehnung).
3. **Logik:** Ist die Reihenfolge konsistent (Parent vor Child)?
4. **Platzhalter:** Sind die Platzhalter in den URLs durch den Plan oder den Scope auflösbar?

Antworte zwingend im JSON-Format.

### JSON OUTPUT FORMAT:
Falls alles okay ist: { "status": "valid" }
Falls etwas fehlt oder unlogisch ist: { "status": "incomplete", "missing": ["key1", "key2"], "reason": "Detaillierte Erklärung der Mängel" }
`;

    let executionPlan: any = null;
    let attempts = 0;
    let feedback = "";

    while (attempts < 4) {
        const messages: ChatMessage[] = [
            { role: "system", content: "Du bist ein präziser API Planning Agent. Du MUSST strikt auf das Feedback des Verifizierers reagieren und den Plan entsprechend korrigieren." }
        ];

        if (feedback) {
            messages.push({ 
                role: "user", 
                content: `${planningPrompt}\n\n### DEIN VORHERIGER PLAN WAR UNVOLLSTÄNDIG.\n### FEEDBACK VOM VERIFIZIERER:\n${feedback}\n\nBitte erstelle einen neuen, korrigierten Plan, der ALLE Kritikpunkte adressiert.` 
            });
        } else {
            messages.push({ role: "user", content: planningPrompt });
        }

        const planningRes = await this.provider.chat(messages, undefined, { response_format: { type: "json_object" } });

        if (!planningRes.content) throw new Error("Kein Plan generiert.");
        const draftPlan = JSON.parse(planningRes.content);

        // Verifizierung
        const verifRes = await this.provider.chat([
            { role: "system", content: "Du bist ein strenger aber fairer Verifizierer. Konzentriere dich auf die Erreichbarkeit der Daten und die logische Konsistenz. Akzeptiere den Plan, wenn die Kern-Daten (Tasks, Projekte) gezählt werden können. Antworte im JSON-Format." },
            { role: "user", content: verificationPrompt.replace('{{PLAN}}', JSON.stringify(draftPlan, null, 2)) }
        ], undefined, { response_format: { type: "json_object" } });

        const verification = JSON.parse(verifRes.content || '{"status":"valid"}');

        if (verification.status === "valid") {
            executionPlan = draftPlan;
            await this.context.writeChatMessage('assistant', `✅ Discovery-Plan verifiziert: ${executionPlan.summary}`, stepNumber);
            break;
        } else {
            const missingInfo = verification.missing && verification.missing.length > 0 
                ? `Fehlende Endpunkte: ${verification.missing.join(', ')}.` 
                : "";
            feedback = `${missingInfo} Grund: ${verification.reason || "Unbekannter Fehler in der Plan-Logik."}`;
            
            await this.context.writeChatMessage('assistant', `⚠️ **Plan-Verifizierung fehlgeschlagen (Versuch ${attempts + 1}/4):**\n${feedback}`, stepNumber);
            attempts++;
        }
    }

    if (!executionPlan || !executionPlan.plan || executionPlan.plan.length === 0) {
         return { success: false, error: "Konnte keinen validen Discovery-Plan erstellen.", isLogicalFailure: true };
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
6. **WICHTIG:** Benenne die gesammelten Entities im Output exakt so, wie sie in den Endpunkten heißen (z.B. 'project_tasks' anstatt sie zu 'tasks' umzubenennen). Belasse die Bezeichnungen spezifisch!

### FINAL JSON FORMAT:
Sobald alle Schritte ausgeführt und alle Daten gesammelt wurden, antworte mit folgendem JSON:
{
  "entities": [
    { "name": "string (exakter Endpunkt/Objekt-Name, z.B. project_tasks, lists)", "count": number (Echter totalCount aus der API), "complexity": "low" | "medium" | "high" }
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
        { role: "system", content: "Du bist ein präziser API Execution Agent. Antworte im JSON-Format." },
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
