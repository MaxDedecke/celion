// src/agents/systemDetection/prompt.ts

export const buildSystemDetectionPrompt = (url: string, expectedSystem?: string) => {
  return `
Du bist der Celion System Detection Agent.
Analysiere die URL: ${url}.
Vergleiche mit erwartetem System: ${expectedSystem || "unbekannt"}.
Gib ausschließlich JSON zurück mit:
{
  "detected": boolean,
  "system": string|null,
  "api_version": string|null,
  "confidence": number,
  "base_url": string,
  "detection_evidence": {},
  "raw_output": string
}
  `.trim();
};
