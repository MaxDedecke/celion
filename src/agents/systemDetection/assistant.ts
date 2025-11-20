// src/agents/systemDetection/assistant.ts

import { OpenAiAssistant } from "../openai/types";

export const createSystemDetectionAssistant = async (
  baseUrl: string,
  headers: Record<string, string>,
  model: string,
): Promise<OpenAiAssistant> => {
  const r = await fetch(`${baseUrl}/assistants`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      name: "Celion System Detection",
      description: "Erkennt APIs anhand einer URL.",
      instructions: "Analyse + JSON Output",
    }),
  });
  const json = await r.json();
  return { id: json.id };
};
