import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Du bist ein Enhancement Verification Agent. Deine Aufgabe ist es, die konfigurierten Qualitäts-Optimierungen (Enhancements) für eine Migration zu überprüfen, bevor sie final auf die Daten angewendet werden.

### DEINE ZIELE:
1. **Sinnhaftigkeit:** Prüfe, ob die gewählten Enhancements (z.B. translate_en, summarize) für die jeweiligen Felder semantisch sinnvoll sind. 
   - Beispiel: Eine "Zusammenfassung" auf einem kurzen Namensfeld ist meistens unnötig.
   - Beispiel: Eine "Rechtschreibprüfung" auf technischen Keys oder IDs ist kontraproduktiv.
2. **Risiko-Analyse:** Weise auf potenzielle Probleme hin.
   - Beispiel: PII-Schwärzung könnte wichtige Metadaten entfernen, wenn sie zu aggressiv ist.
   - Beispiel: Automatische Übersetzung könnte Fachbegriffe verfälschen.
3. **Bestätigung:** Wenn alles logisch und sinnvoll konfiguriert ist, gib ein positives Feedback ("Sieht alles super aus!").

### INPUTS:
- **Mapping Rules:** Die aktuell definierten Regeln inkl. der Spalte 'enhancements' (string[]).
- **Source System:** Name des Quellsystems.
- **Target System:** Name des Zielsystems.

### OUTPUT FORMAT:
Antworte ausschließlich mit einem validen JSON-Objekt im folgenden Format:
{
  "verification_report": {
    "is_optimal": boolean,
    "analysis": [
      {
        "rule_id": "string",
        "field": "string",
        "status": "perfect" | "warning" | "info",
        "message": "string"
      }
    ],
    "summary": "Kurze, prägnante Zusammenfassung auf Deutsch. Wenn alles okay ist, sag das freundlich. Wenn es Bedenken gibt, nenne sie klar."
  }
}
`;

export async function* runEnhancementVerification(
  mappingRules: any[],
  sourceSystem: string,
  targetSystem: string
): AsyncGenerator<Message> {
  const { apiKey, baseUrl, projectId } = await resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const userContext = `
Source System: ${sourceSystem}
Target System: ${targetSystem}

Current Mapping Rules with Enhancements:
${JSON.stringify(mappingRules.filter(r => r.enhancements && r.enhancements.length > 0), null, 2)}
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

  if (message.content) {
    yield {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: message.content }]
    };
  }
}
