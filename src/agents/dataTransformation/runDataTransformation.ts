import { Message } from '../openai/types';
import { buildOpenAiHeaders, resolveOpenAiConfig } from '../openai/openaiClient';

const SYSTEM_PROMPT = `
Du bist ein Data Transformation Agent. Deine Aufgabe ist es, Qualitäts-Verbesserungen (Enhancements) auf eine Liste von Datensätzen anzuwenden.

### DEINE MISSION:
- Du erhältst eine Liste von Objekten (JSON).
- Du erhältst eine Konfiguration, welche Felder mit welchen Enhancements bearbeitet werden sollen.
- Du gibst die bearbeiteten Objekte zurück.

### VERFÜGBARE ENHANCEMENT-TYPEN:
- **spellcheck**: Prüft und korrigiert Rechtschreibung und Grammatik im Text.
- **tone_check**: Passt den Text an eine professionelle, sachliche Tonalität an.
- **summarize**: Erstellt eine prägnante Zusammenfassung des Inhalts (ideal für lange Beschreibungen).
- **pii_redact**: Entfernt personenbezogene Daten (Email, Namen, Telefonnummern) und ersetzt sie durch Platzhalter wie [NAME], [EMAIL].
- **translate_en**: Übersetzt den Text ins Englische.
- **sentiment**: Analysiert die Stimmung des Textes und gibt einen Wert zurück (z.B. "positive", "neutral", "negative"). Dieser Wert soll in ein neues Feld namens '[FELDNAME]_sentiment' geschrieben werden.

### WICHTIGE REGELN:
- Verändere NUR die Felder, für die ein Enhancement konfiguriert wurde.
- Behalte alle anderen Felder (insbesondere IDs wie 'external_id', 'id' etc.) UNVERÄNDERT bei.
- Antworte ausschließlich mit einem validen JSON-Array der bearbeiteten Objekte.
- Wenn mehrere Enhancements für ein Feld konfiguriert sind, wende sie nacheinander an.

### OUTPUT FORMAT:
Antworte NUR mit dem JSON-Array:
[
  { "id": "...", "field1": "verbesserter text", ... },
  ...
]
`;

export async function runDataTransformation(
  items: any[],
  config: Record<string, string[]> // Map of field_name -> enhancement_types[]
): Promise<any[]> {
  const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
  const headers = buildOpenAiHeaders(apiKey, projectId);

  const userContext = `
### DATENSÄTZE:
${JSON.stringify(items, null, 2)}

### KONFIGURATION (Feld -> Enhancements):
${JSON.stringify(config, null, 2)}

Bitte verarbeite die Datensätze jetzt und gib das resultierende JSON-Array zurück.
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
  const content = data.choices[0].message.content;

  try {
    const parsed = JSON.parse(content);
    // If the LLM wraps it in a key like "items" or "results", extract it
    if (Array.isArray(parsed)) return parsed;
    if (parsed.items && Array.isArray(parsed.items)) return parsed.items;
    if (parsed.results && Array.isArray(parsed.results)) return parsed.results;
    if (parsed.data && Array.isArray(parsed.data)) return parsed.data;
    
    // Fallback: search for the first array found in the object
    for (const key in parsed) {
        if (Array.isArray(parsed[key])) return parsed[key];
    }
    
    return [parsed]; // Single object case
  } catch (e) {
    console.error("Failed to parse transformation result", e, content);
    throw new Error("Invalid transformation result format");
  }
}
