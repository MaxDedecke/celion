import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Du bist ein Mapping Verification Agent. Deine Aufgabe ist es, die bestehenden Mapping-Regeln für eine Migration zu überprüfen.

### DEINE ZIELE:
1. **Vollständigkeit:** Prüfe, ob für alle im Quellsystem gefundenen Entitäten (Source Entities) mit einem Count > 0 entsprechende Mapping-Regeln existieren.
   - **WICHTIG:** Ignorierte Entitäten (isIgnored: true) müssen NICHT gemappt werden.
   - **WICHTIG:** Entitäten mit Count 0 müssen NICHT gemappt werden. Wenn Regeln dafür existieren, ist das gut, aber kein Muss.
2. **Konsistenz & Inventar-Unabhängigkeit:** 
   - Es ist völlig normal, dass Mapping-Regeln für Objekte existieren, die NICHT in den "Source Entities" (Inventar aus Schritt 3) aufgeführt sind oder dort einen Count von 0 haben. 
   - **REGEL:** Melde das Fehlen eines Objekts im Inventar NIEMALS als Fehler oder Warnung, solange für dieses Objekt Regeln existieren. Behandle diese Regeln als "valid", sofern die Felder laut Spezifikation (Source Object Specs) existieren.
   - Die Überprüfung der Regeln erfolgt rein auf Basis der Spezifikationen (Specs), nicht auf Basis der tatsächlich gefundenen Datenmengen.
3. **Validität & Semantik:** Bewerte, ob die Mappings semantisch sinnvoll sind.
   - Prüfe Datentypen: Passt ein "date" Feld zu einer "id" (wahrscheinlich nicht)?
   - **IGNORE-Regeln:** Wenn eine Regel den Typ 'IGNORE' hat, ist dies eine gültige Zuordnung.
4. **Pflichtfelder:** Prüfe, ob alle Pflichtfelder im Zielsystem abgedeckt werden (für die Objekte, für die Mappings existieren).

### INPUTS:
- **Source Entities:** Inventar aus Schritt 3 (inkl. counts und isIgnored).
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
  "summary": "Detaillierte deutsche Zusammenfassung. Erwähne kurz, welche Objekte ignoriert werden oder 0 Instanzen haben, aber markiere dies explizit als UNPROBLEMATISCH. Konzentriere dich auf echte semantische Fehler oder fehlende Pflichtfelder."
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
