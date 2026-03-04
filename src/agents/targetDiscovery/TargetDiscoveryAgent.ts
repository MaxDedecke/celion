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
    const migrationContext = migrationDetails?.context || {};
    
    // Normalize targetName if placeholder '-'
    if (scopeConfig.targetName === "-") {
        scopeConfig.targetName = scopeConfig.sourceScopeName || migrationName || "New Project";
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
    const detailMsg = `Ich analysiere die Kompatibilität von **${targetSystem}**${scopeConfig?.targetName ? ` (Ziel-Scope: **${scopeConfig.targetName}**)` : ''}.`;
    await this.context.writeChatMessage('assistant', detailMsg, stepNumber);

    const email = connector.username || "";
    const token = connector.api_key || "";
    const base64Credentials = btoa(`${email}:${token}`);

    const SYSTEM_PROMPT = `
Du bist die Target Validation Engine von Celion. Dein Ziel ist es, die Einsatzbereitschaft des Zielsystems für die anstehende Migration sicherzustellen.

### MIGRATIONS-GEDÄCHTNIS:
${JSON.stringify(migrationContext, null, 2)}

### PHASE 1: TARGET EXPLORATION & SCOPE VALIDATION
- Nutze 'smart_discovery', um die Top-Level-Strukturen (Workspaces, Projekte, Ordner) des Zielsystems aufzulisten.
- FALLS KEIN 'sourceScope' (Quell-Projekt/ID) in der 'Scope Config' angegeben ist:
    * Dies ist eine VOLL-MIGRATION. Das Zielsystem MUSS leer sein (keine User-Projekte/Daten).
    * Falls das System NICHT leer ist: Setze 'targetScope.status' auf 'conflict' und warne in der 'summary'.
    * Falls das System leer ist: Setze 'targetScope.status' auf 'ready' und 'targetScope.isTargetEmpty' auf true.
- FALLS EIN 'sourceScope' (Quell-Projekt/ID) angegeben ist:
    * Dies ist eine BEREICHS-MIGRATION. Das Zielsystem DARF bereits Daten/Projekte enthalten.
    * Falls ein 'targetName' angegeben ist: Suche nach einer Entität mit diesem Namen. 
        - Falls gefunden: Dokumentiere die ID und prüfe auf Schreibrechte. Status: 'ready'.
        - Falls NICHT gefunden: Dies ist IDEAL für einen neuen Import. Setze 'targetScope.found' auf false, aber 'targetScope.status' auf 'ready', da wir den Bereich in Schritt 8 neu anlegen werden.
    * Falls KEIN 'targetName' angegeben ist: Prüfe die allgemeine Erreichbarkeit für neue Projekte.
    * Setze 'targetScope.status' auf 'ready', solange keine kritischen API-Fehler (z.B. 'unauthorized') vorliegen.

### PHASE 2: COMPATIBILITY & PERMISSIONS
- Überprüfe Schreibrechte für die wichtigsten Entitäten (Tasks, Folders, etc.).
- Identifiziere die 'writableEntities'.

### FINAL JSON FORMAT:
{
  "targetScope": {
    "found": boolean,
    "id": "string | null",
    "name": "string | null",
    "status": "ready" | "conflict" | "unauthorized",
    "isTargetEmpty": boolean
  },
  "compatibility": {
    "writableEntities": ["string"],
    "existingEntities": ["string"]
  },
  "summary": "Deutsche Zusammenfassung: Ist das Ziel für den gewählten Modus (Voll vs. Bereich) geeignet?",
  "rawOutput": "Detaillierte Liste der gefundenen Strukturen im Zielsystem."
}
`;

    const TOOLS: Tool[] = [
      {
        type: "function",
        function: {
          name: "smart_discovery",
          description: "Führt eine intelligente Discovery-Anfrage durch, inklusive automatischer Pagination über alle Seiten.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "Die vollständige URL zum Endpunkt." },
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
Target URL: ${targetUrl}
Credentials: ${connector.username ? 'Email provided' : 'No email'}, Token provided
System Scheme: ${JSON.stringify(discoveryScheme, null, 2)}
Scope Config: ${JSON.stringify(scopeConfig || {}, null, 2)}

### TARGET VALIDATION TASK:
Bitte prüfe, ob das Zielsystem bereit ist. 
${scopeConfig?.sourceScope ? `Bereichs-Migration (Quelle: ${scopeConfig.sourceScope}). Vorhandene Daten im Ziel sind erlaubt.` : 'Voll-Migration geplant. Zielsystem sollte leer sein.'}
${scopeConfig?.targetName ? `Besonderer Fokus: Ziel-Projekt/Workspace soll "**${scopeConfig.targetName}**" heißen.` : ''}
    `;

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContext }
    ];

    let lastMessageText: string | undefined;

    for (let turn = 0; turn < 15; turn++) {
      const response = await this.provider.chat(messages, TOOLS, { 
          model: process.env.OPENAI_MODEL || "gpt-4o",
          response_format: { type: "json_object" } 
      });

      const message: ChatMessage = {
          role: 'assistant',
          content: response.content,
          tool_calls: response.toolCalls
      };
      messages.push(message);

      if (message.content) {
        lastMessageText = message.content;
        if (!message.content.trim().startsWith('{')) {
          await this.context.writeChatMessage('assistant', message.content, stepNumber);
        }
      }

      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          const functionName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          let result: any;

          try {
            if (functionName === 'smart_discovery') {
              const requestHeaders: Record<string, string> = { ...args.headers };
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

              result = await smartDiscovery({
                url: args.url,
                method: args.method || 'GET',
                headers: requestHeaders,
                body: args.body,
                paginationConfig: discoveryScheme?.discovery?.pagination
              });
              
              if (result.sampleData) {
                const sampleStr = JSON.stringify(result.sampleData);
                if (sampleStr.length > 10000) {
                  result.sampleData = sampleStr.slice(0, 10000) + '...[TRUNCATED]';
                }
              }
            } else {
              result = { error: `Unknown tool: ${functionName}` };
            }
          } catch (error) {
            result = { error: error instanceof Error ? error.message : String(error) };
          }

          messages.push({
            tool_call_id: toolCall.id,
            role: "tool",
            name: functionName,
            content: JSON.stringify(result)
          });
        }
      } else {
        break;
      }
    }

    if (lastMessageText) {
      try {
        const parsed = JSON.parse(lastMessageText);
        let isLogicalFailure = false;
        let failureMessage = "";

        if (parsed.targetScope?.status === 'not_found' || parsed.targetScope?.status === 'unauthorized' || parsed.targetScope?.status === 'conflict') {
          isLogicalFailure = true;
          failureMessage = parsed.summary || `Ziel-Konfiguration fehlerhaft: ${parsed.targetScope?.status}`;
        }
        
        return {
            success: !isLogicalFailure,
            result: parsed,
            isLogicalFailure,
            error: failureMessage
        };
      } catch (e) {
        return {
            success: false,
            result: { text: lastMessageText },
            isLogicalFailure: true,
            error: "Agent lieferte kein gültiges JSON Ergebnis."
        };
      }
    } else {
      return {
          success: false,
          result: { error: 'Target agent produced no output' },
          isLogicalFailure: true,
          error: "Target agent produced no output."
      };
    }
  }
}
