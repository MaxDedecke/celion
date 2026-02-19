import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Du bist der Celion Enhancement Rules Agent. Deine Aufgabe ist es, den Benutzer beim Veredeln seiner Mapping-Regeln zu unterstützen (Schritt 7).

### DEINE ZIELE:
1.  Analysiere die bestehenden Mappings (Feld-zu-Feld) und schlage passende Qualitäts-Verbesserungen vor.
2.  Fokus liegt auf der Verbesserung der Ziel-Datenqualität durch KI-gestützte Transformationen.

### VERFÜGBARE ENHANCEMENT-TYPEN:
- **spellcheck**: Prüft und korrigiert Rechtschreibung und Grammatik.
- **tone_check**: Passt den Text an eine professionelle Tonalität an.
- **summarize**: Erstellt eine prägnante Zusammenfassung des Inhalts.
- **pii_redact**: Entfernt personenbezogene Daten (Email, Namen, Telefonnummern).
- **translate_en**: Übersetzt den Text ins Englische.
- **sentiment**: Analysiert die Stimmung des Textes.

### DEIN VERHALTEN:
- Analysiere die Quell- und Ziel-Feldnamen in den Mappings. Für Textfelder (z.B. Description, Summary, Comments) sind Enhancements besonders wertvoll.
- Wenn der Benutzer "Vorschläge" oder "Was kann ich optimieren?" fragt, liste die bestehenden Mappings auf und schlage passende Optimierungen dafür vor.
- Nutze das Tool 'add_enhancement_to_mapping', um ein Enhancement zu einer bestehenden Regel hinzuzufügen.
- Antworte immer auf Deutsch.

### FORMATIERUNG:
- Nutze Markdown für Listen und Tabellen.
- Präsentiere Vorschläge übersichtlich: Mapping (Quelle -> Ziel) | Vorgeschlagenes Enhancement | Grund.
`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "add_enhancement_to_mapping",
      description: "Fügt einer bestehenden Mapping-Regel ein Qualitäts-Enhancement hinzu.",
      parameters: {
        type: "object",
        properties: {
          rule_id: { type: "string", description: "Die ID der bestehenden Mapping-Regel (MAP)" },
          enhancement_type: { 
            type: "string", 
            enum: ["spellcheck", "tone_check", "summarize", "pii_redact", "translate_en", "sentiment"],
            description: "Der technische Typ des Enhancements"
          }
        },
        required: ["rule_id", "enhancement_type"]
      }
    }
  }
];

export async function* runEnhancementRules(
  userMessage: string,
  context: {
    sourceEntities: any[];
    sourceSchema: any;
    currentEnhancements: any[];
    history: { role: string; content: string }[];
    migrationId: string;
  }
): AsyncGenerator<Message> {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);
  const backendUrl = process.env.INTERNAL_BACKEND_URL || "http://backend:8000";
  
  const historyPrompt = context.history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n');
  
  const userContext = `
### MIGRATIONS-ID:
${context.migrationId}

### BESTEHENDE MAPPINGS (Mögliche Ziele für Enhancements):
${JSON.stringify(context.currentEnhancements.filter(r => r.rule_type === 'MAP'), null, 2)}

### QUELL-SCHEMA:
${JSON.stringify(context.sourceSchema, null, 2)}

### BISHERIGER CHAT-VERLAUF:
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

        console.log(`[EnhancementRules] Tool Call: ${functionName}`, args);

        try {
          if (functionName === 'add_enhancement_to_mapping') {
            // Fetch all rules to find the target one
            const rulesRes = await fetch(`${backendUrl}/api/migrations/${context.migrationId}/mapping-rules`);
            const allRules = await rulesRes.json();
            const rule = allRules.find((r: any) => r.id === args.rule_id);

            if (rule) {
                const currentEnhancements = rule.enhancements || [];
                if (!currentEnhancements.includes(args.enhancement_type)) {
                    const newEnhancements = [...currentEnhancements, args.enhancement_type];
                    const updateRes = await fetch(`${backendUrl}/api/migrations/${context.migrationId}/mapping-rules/${args.rule_id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ enhancements: newEnhancements })
                    });
                    const updatedRule = await updateRes.json();
                    result = { success: true, rule: updatedRule };
                } else {
                    result = { success: true, message: "Enhancement already active", rule };
                }
            } else {
                result = { error: "Rule not found" };
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
