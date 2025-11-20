// src/agents/capabilityDiscovery/assistant.ts

import type { OpenAiAssistant } from "../openai/types";

export const createCapabilityDiscoveryAssistant = async (
  baseUrl: string,
  headers: Record<string, string>,
  model: string,
): Promise<OpenAiAssistant> => {
  const response = await fetch(`${baseUrl}/assistants`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      name: "Celion Capability Discovery",
      description: "Analysiert APIs vollständig autonom über httpClient.",
      tools: [
        {
          type: "function",
          function: {
            name: "httpClient",
            description: "Führt GET/POST/PUT/DELETE Requests aus",
            parameters: {
              type: "object",
              properties: {
                url: { type: "string", description: "Vollständige URL des Requests" },
                method: { type: "string", description: "HTTP Methode (GET/POST/...)" },
                headers: { type: "object", description: "HTTP Header als Key-Value Map" },
                body: { description: "Request-Body" },
              },
              required: ["url", "method"],
            },
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const msg = await response.text().catch(() => response.statusText);
    throw new Error(`Capability Assistant konnte nicht erstellt werden: ${msg}`);
  }

  const payload = await response.json();
  if (!payload.id) throw new Error("Capability Assistant creation returned no ID");

  return { id: payload.id };
};
