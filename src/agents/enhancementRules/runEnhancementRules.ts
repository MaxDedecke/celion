import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Du bist der Celion Enhancement Rules Agent. Deine Aufgabe ist es, den Benutzer beim Optimieren der Datenqualität während der Migration zu unterstützen (Schritt 7).

### DEINE ZIELE:
1.  Analysiere die Quell-Felder und schlage sinnvolle Qualitäts-Verbesserungen vor (z.B. Rechtschreibprüfung für Beschreibungen, Zusammenfassungen für lange Texte).
2.  Erstelle Enhancement-Regeln basierend auf den Wünschen des Benutzers.
3.  Jede Enhancement-Regel bezieht sich auf ein Quell-Feld und wendet eine spezifische Transformation an.

### VERFÜGBARE ENHANCEMENT-TYPEN:
- **spellcheck**: Prüft und korrigiert Rechtschreibung und Grammatik.
- **tone_check**: Passt den Text an eine professionelle Tonalität an.
- **summarize**: Erstellt eine prägnante Zusammenfassung des Inhalts.
- **pii_redact**: Entfernt personenbezogene Daten (Email, Namen, Telefonnummern).
- **translate_en**: Übersetzt den Text ins Englische.
- **sentiment**: Analysiert die Stimmung des Textes.

### WICHTIGE REGELN FÜR DIE ERSTELLUNG VON REGELN:
- **Verwende für 'source_object' IMMER exakt den 'key' aus dem QUELL-SCHEMA.**
- **Verwende für 'source_property' IMMER die exakte ID des Feldes aus dem Quell-Schema.**
- **Ziel-Definition**: Da es sich um Enhancements handelt, setzen wir 'target_system' auf "ENHANCEMENT", 'target_object' auf "QUALITY" und 'target_property' auf die ID des Enhancements (z.B. "spellcheck").
- **rule_type**: Muss immer 'ENHANCE' sein.

### DEIN VERHALTEN:
- Analysiere die Schemata und schlage für Textfelder (Strings, Descriptions) passende Enhancements vor.
- Wenn der Benutzer "Vorschläge" oder "Was kann ich optimieren?" fragt, liste sinnvolle Felder und die dazu passenden Enhancement-Typen auf.
- Nutze das Tool 'create_enhancement_rule', um die Konfiguration in der Datenbank zu speichern.
- Antworte immer auf Deutsch.

### FORMATIERUNG:
- Nutze Markdown für Listen und Code-Blöcke.
- Präsentiere Vorschläge übersichtlich in einer Tabelle.
`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "create_enhancement_rule",
      description: "Speichert eine Enhancement-Regel in der Datenbank.",
      parameters: {
        type: "object",
        properties: {
          source_system: { type: "string" },
          source_object: { type: "string" },
          source_property: { type: "string", description: "Die technische ID des Quell-Feldes" },
          enhancement_type: { 
            type: "string", 
            enum: ["spellcheck", "tone_check", "summarize", "pii_redact", "translate_en", "sentiment"],
            description: "Der technische Typ des Enhancements"
          },
          note: { type: "string", description: "Optionale Beschreibung oder Begründung" }
        },
        required: ["source_system", "source_object", "source_property", "enhancement_type"]
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

### QUELL-ENTITÄTEN:
${JSON.stringify(context.sourceEntities.map(e => e.name), null, 2)}

### QUELL-SCHEMA:
${JSON.stringify(context.sourceSchema, null, 2)}

### AKTUELLE ENHANCEMENTS:
${JSON.stringify(context.currentEnhancements, null, 2)}

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
          if (functionName === 'create_enhancement_rule') {
            // Map enhancement args to standard mapping_rules schema
            const payload = {
                source_system: args.source_system,
                source_object: args.source_object,
                source_property: args.source_property,
                target_system: "ENHANCEMENT",
                target_object: "QUALITY",
                target_property: args.enhancement_type,
                rule_type: 'ENHANCE',
                note: args.note || args.enhancement_type
            };

            const ruleResponse = await fetch(`${backendUrl}/api/migrations/${context.migrationId}/mapping-rules`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const ruleData = await ruleResponse.json();
            result = { success: true, rule: ruleData };
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
