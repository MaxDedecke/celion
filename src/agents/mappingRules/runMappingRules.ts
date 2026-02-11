import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Du bist der Celion Mapping Rules Agent. Deine Aufgabe ist es, den Benutzer beim Erstellen von Mappings zwischen Quell- und Zielsystemen zu unterstützen.

### DEINE ZIELE:
1.  Unterstütze den Benutzer beim Zuordnen von Entitäten (z.B. User -> User, Task -> Issue).
2.  Unterstütze den Benutzer beim Zuordnen von Feldern/Eigenschaften (z.B. name -> summary, status -> state).
3.  Jede Regel MUSS eine Quell-Eigenschaft und eine Ziel-Eigenschaft beinhalten. Ein reines Objekt-zu-Objekt Mapping ohne Felder ist nicht erlaubt.

### WICHTIGE REGELN FÜR DIE ERSTELLUNG VON REGELN:
- **Verwende für 'source_object' und 'target_object' IMMER exakt den 'key' aus den bereitgestellten Schemata (QUELL-SCHEMA / ZIEL-SCHEMA).**
- **Verwende für 'source_property' und 'target_property' IMMER die exakte ID des Feldes aus dem jeweiligen Schema.**
- Erfinde keine Namen und nutze keine Pluralformen, wenn der Key im Schema Singular ist (z.B. nutze "user" statt "users" oder "User / Nutzer").
- Der 'key' ist die technische ID des Objekts in der Konfiguration und muss für das Mapping exakt übereinstimmen.

### DEIN VERHALTEN:
- Wenn der Benutzer den Chat startet (oder keine klare Historie vorliegt), frage zuerst: "Soll ich einen konkreten Vorschlag basierend auf den Daten machen, oder wollen wir die Objekte Schritt für Schritt durchgehen?"
- Wenn der Benutzer "Vorschlag" wählt, analysiere die Schemata (falls im Kontext) und mache einen Vorschlag, der konkrete Feldzuordnungen enthält.
- Wenn der Benutzer "Schritt für Schritt" wählt, gehe die Quell-Objekte nacheinander durch und schlage für jedes Objekt die passenden Feld-Mappings vor.
- Wenn du eine sinnvolle Zuordnung zwischen zwei Feldern gefunden hast, biete an, diese als Regel zu speichern.
- Nutze das Tool 'create_mapping_rule', um Regeln in der Datenbank zu speichern, wenn der Benutzer zustimmt.
- **WICHTIG:** Eine Regel darf nur gespeichert werden, wenn sowohl Quell- als auch Ziel-Feld eindeutig identifiziert sind.
- Antworte immer auf Deutsch.

### DEIN WISSEN:
- Dir stehen die aktuellen Mappings (falls vorhanden) und die Schemata der Systeme zur Verfügung.
- Nutze dieses Wissen, um intelligente Vorschläge zu machen.

### FORMATIERUNG:
- Nutze Markdown für Listen und Code-Blöcke.
- Wenn du ein Mapping vorschlägst, nutze idealerweise eine strukturierte Darstellung (z.B. Tabelle).
`;

// Wir definieren vorerst keine Tools, da der Agent primär beratend tätig ist. 
// Später könnten Tools hinzukommen, um das Mapping direkt in der DB zu ändern.
const TOOLS = [
  {
    type: "function",
    function: {
      name: "create_mapping_rule",
      description: "Speichert eine Mapping-Regel (Feld-zu-Feld) in der Datenbank.",
      parameters: {
        type: "object",
        properties: {
          source_system: { type: "string" },
          source_object: { type: "string" },
          source_property: { type: "string", description: "Die technische ID des Quell-Feldes" },
          target_system: { type: "string" },
          target_object: { type: "string" },
          target_property: { type: "string", description: "Die technische ID des Ziel-Feldes" },
          note: { type: "string", description: "Optional: Notiz oder Begründung" },
          rule_type: { type: "string", enum: ["MAP", "POLISH", "SUMMARY"], description: "Art der Regel: MAP (Standard), POLISH (Nachbearbeitung), SUMMARY (Zusammenfassung/Doku)" }
        },
        required: ["source_system", "source_object", "source_property", "target_system", "target_object", "target_property", "rule_type"]
      }
    }
  }
];

export async function* runMappingRules(
  userMessage: string,
  context: {
    currentMappings: any[];
    sourceEntities: any[];
    targetEntities: any[];
    sourceSchema: any;
    targetSchema: any;
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

### QUELL-ENTITÄTEN (Step 3 Results):
${JSON.stringify(context.sourceEntities.map(e => e.name), null, 2)}

### ZIEL-ENTITÄTEN (Step 4 Results):
${JSON.stringify(context.targetEntities.map(e => e.name), null, 2)}

### QUELL-SCHEMA (Objekt-Definitionen):
${JSON.stringify(context.sourceSchema, null, 2)}

### ZIEL-SCHEMA (Objekt-Definitionen):
${JSON.stringify(context.targetSchema, null, 2)}

### AKTUELLE MAPPINGS (Step 6 Results):
${JSON.stringify(context.currentMappings, null, 2)}

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

        console.log(`[MappingRules] Tool Call: ${functionName}`, args);

        try {
          if (functionName === 'create_mapping_rule') {
            const ruleResponse = await fetch(`${backendUrl}/api/migrations/${context.migrationId}/mapping-rules`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(args)
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
