import { httpClient } from 'src/tools/httpRequest';
import { smartDiscovery } from 'src/tools/smartDiscovery';
import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Du bist eine Data Discovery Engine. Dein Ziel ist eine vollständige und wahrheitsgetreue Bestandsaufnahme der Systemstruktur und der Datenmengen.

### PHASE 1: EXPLORATION (Tool use)
- **VOLLSTÄNDIGE ZÄHLUNG:** Rufe 'smart_discovery' für jeden Endpunkt auf. Das Tool scannt automatisch alle Seiten und liefert dir den exakten 'totalCount'.
- **STRIKTE VOLLSTÄNDIGKEIT:** Du MUSST jeden Endpunkt in 'discovery.endpoints' mindestens einmal prüfen.
- **URL KONSTRUKTION:** Nutze IMMER die 'apiBaseUrl' aus dem Scheme als Basis für alle URLs. Konstruiere vollständige URLs.
- **EFFIZIENZ:** Das Tool liefert dir im Feld 'sampleData' nur maximal 3 Beispieldatensätze zurück, um deinen Kontext sauber zu halten. Das reicht aus, um die Struktur zu verstehen.
- **HALLUZINATIONS-VERBOT:** Erfinde NIEMALS Datenmengen (Counts). Nutze ausschließlich die 'totalCount' Rückgaben der Tool-Calls.
- Antworte während der Exploration nur mit kurzen Status-Updates auf Deutsch.

### PHASE 2: FINAL REPORT (Keine Tool-Calls mehr)
- Erstelle ein valides JSON-Objekt mit der Zusammenfassung.
- Die 'entities[].count' Werte MÜSSEN exakt den 'totalCount' Rückgaben der Tool-Calls entsprechen.
- Dokumentiere im 'coverage' Bereich EHRLICH, welche Endpunkte aufgerufen wurden.

### KOMPLEXITÄTS-BEWERTUNG (1-10):
Bewerte die Komplexität basierend auf der tatsächlichen Gesamtanzahl der Elemente:
- **1-3 (Low):** < 1.000 Elemente.
- **4-6 (Medium):** 1.000 - 10.000 Elemente.
- **7-9 (High):** 10.000 - 100.000 Elemente.
- **10 (Critical):** > 100.000 Elemente.

### FINAL JSON FORMAT:
{
  "entities": [
    { "name": "string", "count": number, "complexity": "low" | "medium" | "high" }
  ],
  "coverage": {
    "totalEndpoints": number,
    "checkedEndpoints": ["string"],
    "missedEndpoints": [
      { "name": "string", "reason": "string" }
    ]
  },
  "estimatedDurationMinutes": number,
  "complexityScore": number, // 1-10
  "executedCalls": ["string"],
  "scope": { "identified": boolean, "name": string | null, "id": string | null, "type": string | null },
  "summary": "Kurze deutsche Zusammenfassung.",
  "rawOutput": "Technischer Bericht."
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
          body: { type: "object", description: "Optionaler Body." }
        },
        required: ["url"]
      }
    }
  }
];

export async function* runSourceDiscovery(
  url: string,
  systemScheme: any,
  credentials: { email?: string; apiToken?: string },
  scopeConfig?: { sourceScope?: string }
): AsyncGenerator<Message> {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const email = credentials.email || "";
  const token = credentials.apiToken || "";
  const base64Credentials = btoa(`${email}:${token}`);

  const endpointKeys = Object.keys(systemScheme?.discovery?.endpoints || {});
  const userContext = `
Source URL: ${url}
Credentials: ${credentials.email ? 'Email provided' : 'No email'}, Token provided
System Scheme: ${JSON.stringify(systemScheme, null, 2)}
Scope Config: ${JSON.stringify(scopeConfig || {}, null, 2)}

### REQUIRED ENDPOINTS TO CHECK:
${endpointKeys.map(k => `- ${k}`).join('\n')}

Du MUSST für JEDEN dieser Endpunkte im finalen Report unter 'coverage' angeben, ob er geprüft wurde oder warum er übersprungen wurde.
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
            // Header-Injektion (ähnlich wie vorher)
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
              paginationConfig: systemScheme?.discovery?.pagination
            });
            
            // Truncate sampleData if too large
            if (result.sampleData) {
              const sampleStr = JSON.stringify(result.sampleData);
              if (sampleStr.length > 4000) {
                result.sampleData = sampleStr.slice(0, 4000) + '...[TRUNCATED]';
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
