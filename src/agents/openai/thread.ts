// src/agents/openai/thread.ts

export const createThread = async (baseUrl: string, headers: Record<string, string>) => {
  const r = await fetch(`${baseUrl}/threads`, { method: "POST", headers, body: "{}" });
  const json = await r.json();
  if (!json.id) throw new Error("Thread creation failed");
  return json.id;
};

export const postUserMessage = async (
  baseUrl: string,
  headers: Record<string, string>,
  threadId: string,
  text: string,
) => {
  await fetch(`${baseUrl}/threads/${threadId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ role: "user", content: [{ type: "text", text }] }),
  });
};
