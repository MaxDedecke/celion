import { AgentBase } from '../core/AgentBase';
import { Tool, ChatMessage } from '../core/LlmProvider';
import { smartDiscovery } from '../../tools/smartDiscovery';
import { loadScheme } from '../../lib/scheme-loader';

export class TargetDiscoveryAgent extends AgentBase {
  async execute(params: any): Promise<any> {
    const { stepNumber, migrationId } = this.context;
    const targetUrl = params?.targetUrl;
    const targetSystem = params?.targetExpectedSystem;

    const headerMsg = "Starte **Target Discovery**";
    await this.context.writeChatMessage('assistant', headerMsg, stepNumber);

    const migrationDetails = await this.context.getMigrationDetails();
    const migrationName = migrationDetails?.name;
    const scopeConfig = migrationDetails?.scope_config || {};
    
    // Check if we need to prompt the user for a target name
    // The property name in scope_config is 'sourceScope', not 'sourceScopeName'
    const sourceScope = scopeConfig.sourceScope;
    const isTargetNameConfirmed = scopeConfig.targetNameConfirmed === true;
    
    const isResuming = isTargetNameConfirmed && sourceScope && sourceScope !== "Alles";
    if (!isResuming) {
        const headerMsg = "Starte **Target Discovery**";
        await this.context.writeChatMessage('assistant', headerMsg, stepNumber);
    }

    if (sourceScope && sourceScope !== "Alles" && !isTargetNameConfirmed) {
        await this.context.writeChatMessage('assistant', `Unter welchem Namen soll der Quell-Bereich "**${sourceScope}**" im Zielsystem angelegt werden?\n\nSchreibe den Namen einfach hier in den Chat, oder übernimm den Namen aus der Quelle.`, stepNumber);
        
        const actionContent = JSON.stringify({
            type: "action",
            actions: [
                { action: `confirm_target_name:${sourceScope}`, label: `"${sourceScope}" übernehmen`, variant: "primary" }
            ]
        });
        await this.context.writeChatMessage('assistant', `\`\`\`json\n${actionContent}\n\`\`\``, stepNumber);

        return {
            success: true,
            isEarlyReturnForPlan: true,
            result: { status: 'waiting_for_name' }
        };
    }

    // Normalize targetName:
    // 1. Check if the user specified a name (stored in targetName)
    // 2. Fallback to source scope name
    // 3. Fallback to the overall migration name
    let targetName = scopeConfig.targetName;
    if (!isTargetNameConfirmed) {
        // If not confirmed yet (e.g. "Alles" migration), try to find a good default
        if (!targetName || targetName === "-" || targetName === "Zielbereich") {
            targetName = sourceScope && sourceScope !== "Alles" ? sourceScope : (migrationName || "New Project");
        }
    }

    const connector = await this.context.getConnector('out');

    if (!connector || (!connector.api_key && !connector.username)) {
      return { 
        success: false, 
        error: `Keine Zugangsdaten für das Zielsystem gefunden.`, 
        isLogicalFailure: true 
      };
    }

    const fullScheme = await loadScheme(targetSystem);
    const discoveryScheme = { ...(fullScheme || {}), apiBaseUrl: fullScheme?.apiBaseUrl, headers: fullScheme?.headers };
    const detailMsg = `Ich analysiere die Kompatibilität von **${targetSystem}** (Ziel-Scope: **${targetName}**).`;
    await this.context.writeChatMessage('assistant', detailMsg, stepNumber);

    const email = connector.username || "";
    const token = connector.api_key || "";
    const base64Credentials = btoa(`${email}:${token}`);

    // --- Phase 1: Planning & Verification Agent ---
    await this.context.writeChatMessage('assistant', 'Phase 1: Erstelle und verifiziere Target-Discovery-Plan...', stepNumber);

    const availableEndpoints = discoveryScheme?.discovery?.endpoints || {};
    const endpointKeys = Object.keys(availableEndpoints);

    const planningPrompt = `
Du bist der Planning Agent für eine Datenmigration in das Zielsystem ${targetSystem}.
Deine Aufgabe ist es, einen sequentiellen Ausführungsplan für API-Aufrufe zu erstellen, um NUR die Top-Level-Strukturen (wie Workspaces, Spaces oder Projekte) des Zielsystems abzufragen.
Dein Hauptziel ist es herauszufinden, ob ein Bereich/Projekt mit dem Namen "${targetName}" bereits existiert.

### WICHTIG:
Ignoriere alle Endpunkte für Details (z.B. Tasks, Folder-Details, Listen-Inhalte). Es geht NUR darum festzustellen, ob der Name "${targetName}" auf der obersten Ebene (oder der Ebene, in der wir erstellen wollen) bereits vergeben ist.

### VERFÜGBARE ENDPUNKTE (AUS SPEC):
${JSON.stringify(availableEndpoints, null, 2)}

### DEIN AUFTRAG:
1. Erstelle einen Plan im JSON-Format mit Schritten.
2. Jeder Schritt muss einen 'endpoint_key' aus der obigen Liste verwenden.
3. Beschränke dich auf die Endpunkte, die nötig sind, um die Namen der obersten Container-Ebenen aufzulisten.

### JSON OUTPUT FORMAT:
{
  "summary": "Erklärung",
  "plan": [
    { "step": 1, "endpoint_key": "string", "url_template": "string", "description": "string" }
  ]
}
`;

    const verificationPrompt = `
Du bist der Plan-Verifizierer. Prüfe den folgenden Plan gegen die verfügbaren Endpunkte.
Stelle sicher, dass die RELEVANTEN Top-Level Endpunkte (z.B. Workspaces, Projekte, Spaces) im Plan enthalten sind, um Namenskonflikte für "${targetName}" zu prüfen.

### REGELN:
1. Akzeptiere den Plan, wenn er die obersten Ebenen abdeckt.
2. Fordere KEINE Endpunkte für Details (Tasks, Kommentare etc.) an. Diese sind in diesem Schritt NICHT erwünscht.
3. Antworte zwingend im JSON-Format.

### VERFÜGBARE ENDPUNKTE:
${endpointKeys.join(', ')}

### VORLÄUFIGER PLAN:
{{PLAN}}

### JSON OUTPUT FORMAT:
Falls alles okay ist: { "status": "valid" }
Falls etwas fehlt: { "status": "incomplete", "missing": ["key1", "key2"], "reason": "Warum wird das benötigt?" }
`;

    let executionPlan: any = null;
    let attempts = 0;
    let feedback = "";

    while (attempts < 3) {
        const currentPlanningPrompt = feedback 
            ? `${planningPrompt}\n\n### DEIN VORHERIGER PLAN WAR UNVOLLSTÄNDIG.\n### FEEDBACK VOM VERIFIZIERER:\n${feedback}\n\nBitte korrigiere den Plan und stelle sicher, dass er alle genannten Punkte erfüllt.`
            : planningPrompt;

        const planningRes = await this.provider.chat([
            { role: "system", content: "Du bist ein präziser API Planning Agent. Antworte im JSON-Format." },
            { role: "user", content: currentPlanningPrompt }
        ], undefined, { response_format: { type: "json_object" } });

        if (!planningRes.content) throw new Error("Kein Plan generiert.");
        const draftPlan = JSON.parse(planningRes.content);

        // Verifizierung
        const verifRes = await this.provider.chat([
            { role: "system", content: "Du bist ein strenger Verifizierer. Antworte im JSON-Format." },
            { role: "user", content: verificationPrompt.replace('{{PLAN}}', JSON.stringify(draftPlan, null, 2)) }
        ], undefined, { response_format: { type: "json_object" } });

        const verification = JSON.parse(verifRes.content || '{"status":"valid"}');

        if (verification.status === "valid") {
            executionPlan = draftPlan;
            await this.context.writeChatMessage('assistant', `✅ Target-Discovery-Plan verifiziert: ${executionPlan.summary}`, stepNumber);
            break;
        } else {
            const missingInfo = verification.missing && verification.missing.length > 0 
                ? `Fehlende Endpunkte: ${verification.missing.join(', ')}.` 
                : "";
            feedback = `${missingInfo} Grund: ${verification.reason || "Unbekannter Fehler in der Plan-Logik."}`;
            
            await this.context.writeChatMessage('assistant', `⚠️ **Plan-Verifizierung fehlgeschlagen (Versuch ${attempts + 1}/3):**\n${feedback}`, stepNumber);
            attempts++;
        }
    }

    if (!executionPlan) {
        return { success: false, error: "Konnte keinen validen Discovery-Plan erstellen.", isLogicalFailure: true };
    }

    // --- Phase 2: Execution Agent ---
    await this.context.writeChatMessage('assistant', 'Phase 2: Führe Target-Discovery-Plan aus...', stepNumber);

    const executionPrompt = `
Du bist die Target Validation Engine von Celion. Dein Ziel ist es, die Einsatzbereitschaft des Zielsystems sicherzustellen und Namenskonflikte zu vermeiden.
Deine Aufgabe ist es, den übergebenen 'Execution Plan' SCHRITT FÜR SCHRITT abzuarbeiten und dabei das Tool 'smart_discovery' zu verwenden.

### API BASE URL:
${discoveryScheme?.apiBaseUrl || "Nicht definiert"}

### DEIN PLAN:
${JSON.stringify(executionPlan.plan, null, 2)}

### ZIEL-NAME (WICHTIG):
Wir möchten einen neuen Bereich/Projekt namens "**${targetName}**" anlegen.

### REGELN FÜR DIE AUSFÜHRUNG:
1. Arbeite den Plan sequentiell ab.
2. Für JEDEN Schritt im Plan rufst du 'smart_discovery' auf (mit vollständig aufgelöster URL).
3. Analysiere die zurückgegebenen Daten. Prüfe, ob es bereits eine Entität (Workspace, Projekt etc.) gibt, die EXAKT so heißt wie der ZIEL-NAME.
4. Falls ein Namenskonflikt besteht, setze "conflict" auf true.
5. Führe für jeden relevanten Endpunkt aus dem Plan Tool-Calls aus.

### FINAL JSON FORMAT:
Sobald alle Schritte ausgeführt wurden, antworte mit folgendem JSON:
{
  "conflict": boolean,
  "conflictReason": "Kurze Erklärung falls conflict=true, andernfalls null",
  "targetScope": {
    "name": "${targetName}",
    "status": "ready" | "conflict" | "unauthorized",
    "existingEntities": ["Liste von gefundenen Namen"]
  },
  "summary": "Deutsche Zusammenfassung",
  "rawOutput": "Detaillierte Liste"
}
`;

    const TOOLS: Tool[] = [
      {
        type: "function",
        function: {
          name: "smart_discovery",
          description: "Führt eine Discovery-Anfrage durch, inklusive automatischer Pagination.",
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
                     const parsed = JSON.parse(message.content);
                     if (parsed.targetScope && typeof parsed.conflict === 'boolean') {
                         phase2Result = parsed;
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

    if (!phase2Result) {
         return { success: false, error: "Ausführung fehlgeschlagen oder kein gültiges Ergebnis geliefert.", isLogicalFailure: true };
    }

    // Ensure targetName is in result for caching
    if (!phase2Result.targetScope) phase2Result.targetScope = {};
    if (!phase2Result.targetScope.name) phase2Result.targetScope.name = targetName;

    if (phase2Result.targetScope?.status === 'unauthorized') {
      return {
          success: false,
          result: phase2Result,
          isLogicalFailure: true,
          error: "Ziel-Konfiguration fehlerhaft: unauthorized"
      };
    }

    // Handle Name Conflict
    if (phase2Result.conflict || phase2Result.targetScope?.status === 'conflict') {
      await this.context.writeChatMessage('assistant', `⚠️ **Namenskonflikt erkannt:** ${phase2Result.conflictReason || `Ein Bereich mit dem Namen '${targetName}' existiert bereits.`}\n\nBitte schreibe einen neuen Namen für den Zielbereich in den Chat, um die Migration fortzusetzen.`, stepNumber);
      
      return {
          success: true,
          isEarlyReturnForPlan: true,
          result: { error: 'Name conflict', status: 'conflict', details: phase2Result }
      };
    }

    // Success
    await this.context.writeChatMessage('assistant', `✅ Zielsystem ist bereit. Keine Namenskonflikte für "${targetName}" gefunden.`, stepNumber);
    return {
        success: true,
        result: phase2Result
    };
  }

  private async handleSmartDiscoveryToolCall(args: any, token: string, base64Credentials: string, discoveryScheme: any): Promise<any> {
      const requestHeaders: Record<string, string> = {};

      if (!args.url) {
        return { error: "Keine URL für smart_discovery angegeben." };
      }

      let finalUrl = args.url;
      if (!finalUrl.startsWith('http') && discoveryScheme?.apiBaseUrl) {
          const baseUrl = discoveryScheme.apiBaseUrl.replace(/\/$/, '');
          const path = finalUrl.startsWith('/') ? finalUrl : `/${finalUrl}`;
          finalUrl = `${baseUrl}${path}`;
      }

      if (finalUrl && (finalUrl.includes('{') || finalUrl.includes('}'))) {
        return { 
            error: `URL enthält noch unaufgelöste Platzhalter: ${finalUrl}. Ersetze diese durch reale IDs oder überspringe sie, falls es Top-Level-Abfragen sind.` 
        };
      }

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
