// src/agents/systemDetection/assistant.ts

import type { OpenAiAssistant } from "../openai/types";

export const createSystemDetectionAssistant = async (
  baseUrl: string,
  headers: Record<string, string>,
  model: string,
  expectedSystem?: string,
) : Promise<OpenAiAssistant> => {

  const expectedSystemNote = expectedSystem
    ? ` WICHTIG: Der Benutzer erwartet, dass es sich bei der URL um ein "${expectedSystem}"-System handelt. Deine Hauptaufgabe ist es zu validieren, ob die URL tatsächlich zu diesem erwarteten System passt. Setze "detected" nur dann auf true, wenn das erkannte System mit "${expectedSystem}" übereinstimmt.`
    : "";

  const instructions = [
    "Du bist der Celion System Detection Agent.",
    "WICHTIG: Der Nutzer gibt eine beliebige URL zu seinem System an (z.B. die URL seines Jira Workspaces wie 'https://company.atlassian.net/jira/...').",
    "Deine Aufgabe ist es, von dieser URL das dahinterliegende System zu identifizieren UND die korrekte API Base-URL abzuleiten.",
    "Beispiel: Aus 'https://company.atlassian.net/jira/for-you' leitest du ab: System='Jira Cloud', base_url='https://company.atlassian.net', api_version='3'.",
    "Nutze den Probe Runner, um verschiedene bekannte API-Endpunkte zu testen und das System zu verifizieren.",
    "Analysiere die bereitgestellte System-URL und validiere, ob sie zum erwarteten Systemtyp passt.",
    "Falls verfügbar, gib auch die vermutete API-Version, relevante HTTP-Header sowie Status-Codes an.",
    "Antworte ausschließlich im JSON-Format und verwende die Felder detected, system, api_version, confidence, base_url, detection_evidence und raw_output.",
    "Setze detected auf true, falls das System mit dem erwarteten Typ übereinstimmt und ausreichend Hinweise vorliegen, andernfalls false.",
    "Confidence soll ein Wert zwischen 0 und 1 sein, der die Sicherheit der Erkennung widerspiegelt.",
    "detection_evidence darf zusätzliche strukturierte Hinweise enthalten (z. B. headers als Liste oder status_codes als Objekt).",
    expectedSystemNote,
  ].join(" ");

  const response = await fetch(`${baseUrl}/assistants`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      name: "Celion System Detection",
      description: "Erkennt Zielsysteme anhand einer URL für Celion Migrationen.",
      instructions,
    }),
  });

  if (!response.ok) {
    const msg = await response.text().catch(() => response.statusText);
    throw new Error("OpenAI Agent konnte nicht erstellt werden: " + msg);
  }

  const payload = await response.json();
  if (!payload.id) throw new Error("OpenAI Agent-Antwort enthielt keine ID.");

  return { id: payload.id };
};
