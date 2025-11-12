import type { NextApiRequest, NextApiResponse } from "next";

const DEFAULT_AGENT_SERVICE_URL = "http://localhost:8000";

const resolveServiceUrl = (): string => {
  const configured =
    process.env.AGENT_SERVICE_URL ??
    process.env.VITE_AGENT_SERVICE_URL ??
    DEFAULT_AGENT_SERVICE_URL;

  const trimmed = configured.trim();
  return trimmed.replace(/\/$/, "");
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Only POST allowed" });
    return;
  }

  const { url } = req.body as { url?: string };
  if (!url) {
    res.status(400).json({ error: "URL required" });
    return;
  }

  try {
    const serviceUrl = resolveServiceUrl();
    const response = await fetch(`${serviceUrl}/agents/system-detection`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const message =
        errorText && errorText.trim().length > 0
          ? errorText
          : `Agent-Service antwortete mit Status ${response.status}`;
      throw new Error(message);
    }

    const result = await response.json();
    res.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error in system detection:", error.message);
      res.status(500).json({ error: error.message });
      return;
    }
    console.error("Unknown error:", error);
    res.status(500).json({ error: "Unknown error" });
  }
}
