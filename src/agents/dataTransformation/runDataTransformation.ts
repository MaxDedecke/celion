import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Du bist ein Data Transformation Agent. Deine Aufgabe ist es, punktuelle Qualitäts-Verbesserungen (Enhancements) an spezifischen Datenfeldern vorzunehmen.

### DEINE MISSION:
- Du erhältst eine Liste von Transformation-Tasks. Jeder Task enthält:
  - 'id': Die eindeutige Kennung des Objekts.
  - 'field': Das zu bearbeitende Feld.
  - 'value': Der aktuelle Wert des Feldes.
  - 'instruction': Das anzuwendende Enhancement oder die Anweisung.

### DEINE AUFGABE:
- Wende die 'instruction' auf den 'value' an.
- Falls die Instruction 'sentiment' ist, gib "positive", "neutral" oder "negative" zurück.
- Gib eine Liste der Korrekturen zurück.

### VERFÜGBARE ENHANCEMENT-TYPEN:
- spellcheck, tone_check, summarize, pii_redact, translate_en, sentiment, INSTRUCTION: [Text]

### WICHTIGE REGELN:
- Antworte ausschließlich mit einem JSON-Objekt, das ein Array "updates" enthält.
- Jedes Update-Objekt muss 'id', 'field' und 'newValue' enthalten.
- Antworte NUR mit dem JSON.

Beispiel:
{
  "updates": [
    { "id": "123", "field": "title", "newValue": "Korrigierter Titel" }
  ]
}
`;

export async function runDataTransformation(
  tasks: { id: string, field: string, value: any, instruction: string }[]
): Promise<{ id: string, field: string, newValue: any }[]> {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const userContext = `
### TRANSFORMATION TASKS:
${JSON.stringify(tasks, null, 2)}
  `;

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContext }
  ];

  const maxRetries = 2;
  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: "gpt-4o-mini", // Mini reicht hier völlig aus und ist günstiger
          messages,
          response_format: { type: "json_object" }
        }),
      });

      if (!response.ok) throw new Error(`API failed: ${response.status}`);

      const data = await response.json();
      const content = data.choices[0]?.message?.content;
      if (!content) throw new Error("Empty content");

      const parsed = JSON.parse(content);
      return parsed.updates || [];

    } catch (error) {
      lastError = error;
      console.error(`[DataTransformation] Attempt ${attempt} failed:`, error);
    }
  }

  throw lastError || new Error("Data transformation failed");
}
