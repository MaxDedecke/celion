import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Du bist der Celion Migration Consultant. Deine Aufgabe ist es, den User während des Migrationsprozesses zu beraten.

### DEINE RESSOURCEN:
1.  **Migrations-Kontext:** Dir werden (falls vorhanden) die Ergebnisse der bisherigen Schritte (System Detection, Auth, Inventory, Target Discovery) zur Verfügung gestellt.
2.  **Chat-Verlauf:** Du siehst die bisherigen Fragen des Users und deine Antworten.

### DEINE REGELN:
- Antworte IMMER auf Deutsch.
- Sei professionell, präzise und hilfreich.
- Wenn eine Frage keinen Bezug zur Migration hat, antworte wie ein allgemeiner KI-Assistent.
- Wenn eine Frage Bezug zur Migration hat (z.B. Kosten, Aufwand, Risiken), nutze die bereitgestellten Daten (Element-Zahlen, Komplexität, Fehlermeldungen) für eine fundierte Einschätzung.
- Falls Daten fehlen (z.B. Schritt 3 wurde noch nicht gemacht), weise höflich darauf hin, dass du für eine genaue Schätzung noch mehr Informationen aus den nächsten Schritten benötigst.
- Behalte den Verlauf im Kopf, um auf Nachfragen (z.B. "Und was ist mit den Kosten?") reagieren zu können.

### FORMATIERUNG:
- Nutze Markdown für eine schöne Darstellung.
`;

export async function* runAnswerAgent(
  userMessage: string,
  context: {
    stepResults: any;
    history: { role: string; content: string }[];
  }
): AsyncGenerator<Message> {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const historyPrompt = context.history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n');
  
  const userContext = `
### AKTUELLE ERGEBNISSE DER SCHRITTE:
${JSON.stringify(context.stepResults, null, 2)}

### BISHERIGER VERLAUF:
${historyPrompt}

### NEUE BENUTZERANFRAGE:
${userMessage}
  `;

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContext }
  ];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: "gpt-4o",
      messages,
      stream: true
    }),
  });

  if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText} ${errorText}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let fullText = "";

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ') && line !== 'data: [DONE]') {
          try {
            const data = JSON.parse(line.slice(6));
            const content = data.choices[0]?.delta?.content;
            if (content) {
              fullText += content;
            }
          } catch (e) {}
        }
      }
    }
  }

  yield {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: fullText }]
  };
}