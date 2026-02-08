import { smartDiscovery } from 'src/tools/smartDiscovery';
import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Du bist die Target Validation Engine von Celion. Dein Ziel ist es, die Einsatzbereitschaft des Zielsystems für die anstehende Migration sicherzustellen.

### PHASE 1: TARGET EXPLORATION & SCOPE VALIDATION
- Nutze 'smart_discovery', um die Top-Level-Strukturen (Workspaces, Projekte, Ordner) des Zielsystems aufzulisten.
- FALLS KEIN 'sourceScope' (Quell-Projekt/ID) in der 'Scope Config' angegeben ist:
    * Dies ist eine VOLL-MIGRATION. Das Zielsystem MUSS leer sein (keine User-Projekte/Daten).
    * Falls das System NICHT leer ist: Setze 'targetScope.status' auf 'conflict' und warne in der 'summary'.
    * Falls das System leer ist: Setze 'targetScope.status' auf 'ready' und 'targetScope.isTargetEmpty' auf true.
- FALLS EIN 'sourceScope' (Quell-Projekt/ID) angegeben ist:
    * Dies ist eine BEREICHS-MIGRATION. Das Zielsystem DARF bereits Daten/Projekte enthalten.
    * Falls ein 'targetName' angegeben ist: Suche nach einer Entität mit diesem Namen. Falls gefunden, dokumentiere die ID und prüfe auf Schreibrechte.
    * Falls KEIN 'targetName' angegeben ist: Prüfe die allgemeine Erreichbarkeit für neue Projekte.
    * Setze 'targetScope.status' auf 'ready', solange kein direkter Namenskonflikt für das neue Projekt besteht.

### PHASE 2: COMPATIBILITY & PERMISSIONS
- Überprüfe Schreibrechte für die wichtigsten Entitäten (Tasks, Folders, etc.).
- Identifiziere die 'writableEntities'.

### FINAL JSON FORMAT:
{
  "targetScope": {
    "found": boolean,
    "id": "string | null",
    "name": "string | null",
    "status": "ready" | "conflict" | "not_found" | "unauthorized",
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

const TOOLS = [
  {
    type: "function",
    function: {
      name: "smart_discovery",
      description: "Führt eine intelligente Discovery-Anfrage durch, inklusive automatischer Pagination.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Die vollständige URL zum Endpunkt." },
          method: { type: "string", enum: ["GET", "POST"], description: "HTTP Methode." },
          headers: { type: "object", description: "Header (Authentifizierung wird automatisch ergänzt)." },
          body: { type: "object", description: "Optionaler Body." },
          discoveryBrake: { type: "boolean", description: "Wenn true, wird nur die erste Seite geladen (kostensparend für Struktur-Erkennung)." }
        },
        required: ["url"]
      }
    }
  }
];

export async function* runTargetDiscovery(
  url: string,
  systemScheme: any,
  credentials: { email?: string; apiToken?: string },
  scopeConfig?: { targetName?: string; sourceScope?: string }
): AsyncGenerator<Message> {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const email = credentials.email || "";
  const token = credentials.apiToken || "";
  const base64Credentials = btoa(`${email}:${token}`);

  const userContext = `
Target URL: ${url}
Credentials: ${credentials.email ? 'Email provided' : 'No email'}, Token provided
System Scheme: ${JSON.stringify(systemScheme, null, 2)}
Scope Config: ${JSON.stringify(scopeConfig || {}, null, 2)}

### TARGET VALIDATION TASK:
Bitte prüfe, ob das Zielsystem bereit ist. 
${scopeConfig?.sourceScope ? `Bereichs-Migration (Quelle: ${scopeConfig.sourceScope}). Vorhandene Daten im Ziel sind erlaubt.` : 'Voll-Migration geplant. Zielsystem sollte leer sein.'}
${scopeConfig?.targetName ? `Besonderer Fokus: Ziel-Projekt/Workspace soll "**${scopeConfig.targetName}**" heißen.` : ''}
  `;

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContext }
  ];

  while (true) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: "gpt-4o",
        messages,
        tools: TOOLS,
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText} ${errorText}`);
    }

    const data = await response.json();
    const choice = data.choices[0];
    const message = choice.message;

    messages.push(message);

    if (message.content) {
      yield {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: message.content }]
      };
    }

    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);
        let result: any;

        try {
          if (functionName === 'smart_discovery') {
            const requestHeaders: Record<string, string> = { ...args.headers };
            const auth = systemScheme?.authentication;
            
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
            
            if (systemScheme?.headers) {
                Object.assign(requestHeaders, systemScheme.headers);
            }

            result = await smartDiscovery({
              url: args.url,
              method: args.method || 'GET',
              headers: requestHeaders,
              body: args.body,
              paginationConfig: systemScheme?.discovery?.pagination,
              discoveryBrake: args.discoveryBrake ?? false
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
}
