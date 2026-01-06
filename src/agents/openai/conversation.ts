// src/agents/openai/conversation.ts

export const createConversation = async (baseUrl: string, headers: Record<string, string>) => {
  const r = await fetch(`${baseUrl}/conversations`, { method: 'POST', headers });
  if (!r.ok) {
    const errorText = await r.text();
    throw new Error(`Conversation creation failed: ${r.status} ${r.statusText} ${errorText}`);
  }
  const json = await r.json();
  if (!json.id) throw new Error("Conversation creation failed, no id in response");
  return json.id;
};
