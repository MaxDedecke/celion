import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Du bist ein Mapping Verification Agent. Deine Aufgabe ist es, die bestehenden Mapping-Regeln für eine Migration zu überprüfen.

### DEINE ZIELE:
1. **Fokus auf Inventar (Schritt 3) & Semantische Zuordnung:** Beziehe dich auf die in "Source Entities" aufgeführten Entitäten.
   - **WICHTIG:** Ein Inventar-Item (z.B. "Project Tasks" oder "Task Details") gilt als VOLLSTÄNDIG gemappt, wenn entsprechende Regeln für den zugehörigen technischen Objekt-Key (z.B. "task") in den Mapping Rules existieren.
   - Nutze die "Source Object Specs", um herauszufinden, welches technische Objekt zu welchem Inventar-Item passt (z.B. über Namensähnlichkeit oder DisplayName).
   - Melde fehlende Mappings NUR, wenn für eine Entität aus dem Inventar WEDER unter ihrem Namen NOCH unter ihrem technischen Key (laut Specs) Regeln existieren.
   - Ignoriere alle Entitäten, die NICHT in "Source Entities" enthalten sind oder dort einen Count von 0 haben (diese wurden bereits vorab gefiltert).
2. **Keine User-Migration:** Es werden KEINE User, Member, Assignees oder Collaborators migriert. 
   - Ignoriere alle Regeln oder Objekte, die sich auf User/Accounts beziehen. Schaue nicht nach User-Mappings.
3. **Vollständigkeit:** Prüfe, ob für alle im Inventar gefundenen Entitäten (direkt oder über ihren technischen Key) entsprechende Mapping-Regeln existieren.
   - **WICHTIG:** Ignorierte Entitäten (isIgnored: true) müssen NICHT gemappt werden.
4. **Validität & Semantik:** Bewerte, ob die Mappings semantisch sinnvoll sind.
   - Prüfe Datentypen: Passt ein "date" Feld zu einer "id" (wahrscheinlich nicht)?
   - **IGNORE-Regeln:** Wenn eine Regel den Typ 'IGNORE' hat, ist dies eine gültige Zuordnung.
5. **Pflichtfelder:** Prüfe, ob alle Pflichtfelder im Zielsystem abgedeckt werden (für die Objekte, für die Mappings existieren).

### INPUTS:
- **Source Entities:** Relevantes Inventar aus Schritt 3 (bereits gefiltert: nur count > 0, keine User).
- **Mapping Rules:** Die aktuell definierten Regeln.
- **Source Object Specs:** Feldspezifikationen des Quellsystems.
- **Target Object Specs:** Feldspezifikationen des Zielsystems.

### OUTPUT FORMAT:
Antworte ausschließlich mit einem validen JSON-OBjekt im folgenden Format:
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
  "summary": "Detaillierte deutsche Zusammenfassung. Konzentriere dich auf echte semantische Fehler oder fehlende Pflichtfelder für die relevanten Entitäten."
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
