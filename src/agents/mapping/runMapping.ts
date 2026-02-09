import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Du bist ein Model Mapping Agent. Deine Aufgabe ist es, Entitäten aus einem Quellsystem den Objekten eines Zielsystems zuzuordnen.

### INPUTS:
1. **Source Entities:** Eine Liste von Entitäten, die in der Discovery-Phase (Schritt 3) im Quellsystem gefunden wurden.
2. **Source Object Specs:** Detaillierte Feldspezifikationen für das Quellsystem.
3. **Target Object Specs:** Detaillierte Feldspezifikationen für das Zielsystem.

### AUFGABE:
- Identifiziere für jede gefundene Quell-Entität das passende Objekt im Zielsystem.
- Erstelle ein Feld-zu-Feld Mapping basierend auf Namen, Typen und Semantik.
- Konzentriere dich NUR auf die Entitäten, die tatsächlich in den Source Entities vorhanden sind.

### OUTPUT FORMAT:
Antworte ausschließlich mit einem validen JSON-Objekt im folgenden Format:
{
  "mappings": [
    {
      "sourceEntity": "string",
      "targetEntity": "string",
      "confidence": number, // 0-1
      "fieldMappings": [
        {
          "sourceField": "string",
          "targetField": "string",
          "reason": "string"
        }
      ]
    }
  ],
  "summary": "Kurze deutsche Zusammenfassung des Mappings."
}
`;

export async function* runMapping(
  sourceEntities: any[],
  sourceSpecs: any,
  targetSpecs: any
): AsyncGenerator<Message> {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const userContext = `
Source Entities (from Step 3):
${JSON.stringify(sourceEntities, null, 2)}

Source Object Specs (${sourceSpecs.system}):
${JSON.stringify(sourceSpecs.objects, null, 2)}

Target Object Specs (${targetSpecs.system}):
${JSON.stringify(targetSpecs.objects, null, 2)}
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
