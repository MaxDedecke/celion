import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Du bist der Celion Mapping Rules Agent. Deine Aufgabe ist es, den Benutzer beim Erstellen von Mappings zwischen Quell- und Zielsystemen zu unterstützen.

### DEINE ZIELE:
1.  Unterstütze den Benutzer beim Zuordnen von Entitäten (z.B. User -> User, Task -> Issue).
2.  Unterstütze den Benutzer beim Zuordnen von Feldern (z.B. name -> summary, status -> state).
3.  Sei hilfreich, präzise und orientiere dich an den Best Practices für Datenmigrationen.

### DEIN VERHALTEN:
- Wenn der Benutzer den Chat startet (oder keine klare Historie vorliegt), frage zuerst: "Soll ich einen konkreten Vorschlag basierend auf den Daten machen, oder wollen wir die Objekte Schritt für Schritt durchgehen?"
- Wenn der Benutzer "Vorschlag" wählt, analysiere die Schemata (falls im Kontext) und mache einen Vorschlag.
- Wenn der Benutzer "Schritt für Schritt" wählt, gehe die Quell-Objekte nacheinander durch.
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
const TOOLS: any[] = []; 

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
        tools: TOOLS.length > 0 ? TOOLS : undefined
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

    // Falls wir später Tools hinzufügen:
    if (message.tool_calls && message.tool_calls.length > 0) {
       // Tool execution logic here
       // For now, break as we have no tools
       break;
    } else {
      break;
    }
  }
}
