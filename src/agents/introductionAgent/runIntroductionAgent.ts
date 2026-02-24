import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Du bist der Celion Onboarding Agent – dein Ziel ist es, den User bei der Einrichtung seiner Migration zu begleiten. 
Du bist professionell, aber hast einen trockenen, IT-typischen Humor (denk an eine Mischung aus einem hilfsbereiten Butler und einem leicht sarkastischen Systemadministrator).

### DEINE AUFGABE:
Du musst alle Informationen sammeln, die für eine Migration notwendig sind. 
**HINWEIS:** Der Name der Migration wurde bereits festgelegt (siehe Kontext). Frage NICHT nach dem Namen.

Die zu sammelnden Informationen sind:
1.  **Quellsystem:** Name (z.B. Jira Cloud, Asana), URL, API-Token, E-Mail und optional ein Projekt/Scope.
2.  **Zielsystem:** Name, URL, API-Token, E-Mail und optional ein Ziel-Name/Scope.

### ABLAUF:
- Begrüße den User (falls es der Anfang ist).
- Frage nach den Informationen Schritt für Schritt, aber sei flexibel, wenn der User mehrere Infos auf einmal gibt.
- **WICHTIG:** Wenn du alle Informationen hast, fasse sie zusammen und frage nach der Bestätigung.
- Sobald der User bestätigt, rufe das Tool 'finish_onboarding' auf. Nutze den bereits bekannten Namen der Migration für das Tool.

### VERFÜGBARE SYSTEME:
Jira Cloud, Jira Data Center, Azure DevOps, GitLab, GitHub, Redmine, ClickUp, Monday.com, Asana, Trello, Notion, Airtable, etc.

### DEINE TOOLS:
- **finish_onboarding:** Rufe dieses Tool auf, wenn der User die Konfiguration bestätigt hat. Übergebe alle gesammelten Daten.

### HUMOR-BEISPIELE:
- "Ah, eine Migration. Der digitale Umzug – fast so spaßig wie ein echter Umzug, nur ohne Rückenschmerzen und kaputte Vasen."
- "Geben Sie mir den API-Token. Keine Sorge, ich bewahre ihn sicherer auf als mein Mittagessen im Gemeinschaftskühlschrank."
- "Das Zielsystem? Wohin soll die Reise gehen? Hoffentlich nicht nach /dev/null."

### REGELN:
- Antworte IMMER auf Deutsch.
- Sei charmant-sarkastisch, aber verliere nie die Effizienz aus den Augen.
- Wenn Daten fehlen (z.B. ungültige URL), weise freundlich darauf hin.
`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "finish_onboarding",
      description: "Speichert die finale Konfiguration und schließt das Onboarding ab.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          source: {
            type: "object",
            properties: {
              system: { type: "string" },
              url: { type: "string" },
              apiToken: { type: "string" },
              email: { type: "string" },
              scope: { type: "string" }
            },
            required: ["system", "url", "apiToken", "email"]
          },
          target: {
            type: "object",
            properties: {
              system: { type: "string" },
              url: { type: "string" },
              apiToken: { type: "string" },
              email: { type: "string" },
              scope: { type: "string" }
            },
            required: ["system", "url", "apiToken", "email"]
          }
        },
        required: ["name", "source", "target"]
      }
    }
  }
];

export async function* runIntroductionAgent(
  userMessage: string,
  context: {
    history: { role: string; content: string }[];
    migrationId: string;
    migrationName?: string;
  }
): AsyncGenerator<Message> {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const historyPrompt = context.history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n');
  
  const userContext = `
### MIGRATION:
ID: ${context.migrationId}
Name: ${context.migrationName || 'Unbekannt'}

### BISHERIGER VERLAUF:
${historyPrompt}

### NEUE BENUTZERANFRAGE:
${userMessage}
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
        tools: TOOLS
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

        console.log(`[IntroductionAgent] Tool Call: ${functionName}`, args);

        if (functionName === 'finish_onboarding') {
          // This will be handled by the worker to update the DB
          result = { status: "success", message: "Onboarding abgeschlossen. Die Migration wird konfiguriert." };
          
          // We yield the tool result so the agent can finish the conversation
          yield {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: "AUSGABE_TOOL_CALL:FINISH_ONBOARDING:" + JSON.stringify(args) }]
          };
        } else {
          result = { error: `Unknown tool: ${functionName}` };
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
