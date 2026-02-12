import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Du bist ein Mapping Verification Agent. Deine Aufgabe ist es, die bestehenden Mapping-Regeln für eine Migration zu überprüfen.

### DEINE ZIELE:
1. **Vollständigkeit:** Prüfe, ob für alle im Quellsystem gefundenen Entitäten (Source Entities) entsprechende Mapping-Regeln existieren.
   - **WICHTIG:** Ignorierte Entitäten (isIgnored: true) müssen NICHT gemappt werden. Markiere sie als erledigt.
2. **Konsistenz:** Überprüfe, ob die Quell- und Zielfelder in den Regeln tatsächlich in den jeweiligen Spezifikationen existieren.
3. **Validität:** Bewerte, ob die Mappings semantisch sinnvoll sind und ob alle Pflichtfelder im Zielsystem abgedeckt werden.
   - **IGNORE-Regeln:** Wenn eine Regel den Typ 'IGNORE' hat, bedeutet dies, dass das Zielfeld absichtlich leer gelassen oder mit einem Dummy-Wert gefüllt wird. Dies ist eine gültige Zuordnung für Pflichtfelder, sofern vom Benutzer so definiert.

### INPUTS:
- **Source Entities:** Liste der im Quellsystem gefundenen Objekte (aus Schritt 3), inklusive 'isIgnored' Status.
- **Mapping Rules:** Die aktuell definierten Regeln (Source Object -> Target Object, Field -> Field), inklusive 'rule_type'.
- **Source Object Specs:** Feldspezifikationen des Quellsystems.
- **Target Object Specs:** Feldspezifikationen des Zielsystems.

### OUTPUT FORMAT:
Antworte ausschließlich mit einem validen JSON-Objekt im folgenden Format:
{
  "verification_report": {
    "is_complete": boolean,
    "missing_entities": ["string"],
    "rule_analysis": [
      {
        "rule_id": "string",
        "status": "valid" | "warning" | "error",
        "message": "string"
      }
    ],
    "target_readiness": {
      "score": number, // 0-100
      "missing_required_fields": [
        {
          "targetEntity": "string",
          "field": "string"
        }
      ]
    }
  },
  "summary": "Detaillierte deutsche Begründung der Überprüfung. Erkläre bei Unvollständigkeit GANZ GENAU, was fehlt (welche Objekte oder Pflichtfelder) und gib konkrete Handlungsempfehlungen für den Benutzer. Erwähne auch explizit, welche Objekte ignoriert werden."
}
`;

export async function* runMappingVerification(
  sourceEntities: any[],
  mappingRules: any[],
  sourceSpecs: any,
  targetSpecs: any
): AsyncGenerator<Message> {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const userContext = `
Source Entities (Inventory):
${JSON.stringify(sourceEntities, null, 2)}

Existing Mapping Rules:
${JSON.stringify(mappingRules, null, 2)}

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
