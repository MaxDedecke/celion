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
- **INSTRUCTION: [Text]**: Eine freie Anweisung für eine Transformation (z.B. "Setze den ersten Buchstaben groß", "Entferne alle Sonderzeichen"). Führe die beschriebene Aktion auf dem Feld aus.

### WICHTIGE REGELN:
- Verändere NUR die Felder, für die ein Enhancement oder eine INSTRUCTION konfiguriert wurde.
- Behalte alle anderen Felder (insbesondere IDs wie 'external_id', 'id' etc.) UNVERÄNDERT bei.
- Antworte ausschließlich mit einem validen JSON-Array der bearbeiteten Objekte.
- Wenn mehrere Enhancements für ein Feld konfiguriert sind, wende sie nacheinander an.

### OUTPUT FORMAT:
Antworte NUR mit dem JSON-Array von Objekten. Jedes Objekt MUSS die ursprüngliche 'external_id' und die transformierten Felder enthalten.

Beispiel:
[
  { "external_id": "123", "name": "Translated Name", "name_sentiment": "positive" },
  { "external_id": "456", "name": "Another Translation", "name_sentiment": "neutral" }
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

  const maxRetries = 3;
  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[DataTransformation] Retry attempt ${attempt}/${maxRetries} after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

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
        let result = parsed;
        if (parsed.items && Array.isArray(parsed.items)) result = parsed.items;
        else if (parsed.results && Array.isArray(parsed.results)) result = parsed.results;
        else if (parsed.data && Array.isArray(parsed.data)) result = parsed.data;
        else if (!Array.isArray(parsed)) {
            // Find first array if not found yet
            for (const key in parsed) {
                if (Array.isArray(parsed[key])) {
                    result = parsed[key];
                    break;
                }
            }
        }
        
        return Array.isArray(result) ? result : [result];
      } catch (e) {
        console.error("Failed to parse transformation result", e, content);
        throw new Error("Invalid transformation result format");
      }
    } catch (error) {
      lastError = error;
      console.error(`[DataTransformation] Attempt ${attempt} failed:`, error instanceof Error ? error.message : String(error));
    }
  }

  throw lastError || new Error("Data transformation failed after multiple retries");
}
