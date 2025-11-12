import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface TextBlock {
  text?: string;
}

function extractText(output: unknown): string {
  if (!Array.isArray(output)) return "";
  const texts: string[] = [];

  for (const item of output) {
    // Prüfen, ob item ein Objekt mit content ist
    if (
      typeof item === "object" &&
      item !== null &&
      "content" in item
    ) {
      const maybeContent = (item as { content: unknown }).content;

      // 💡 Hier die entscheidende Änderung: Typprüfung auf Array
      if (Array.isArray(maybeContent)) {
        for (const block of maybeContent) {
          if (
            typeof block === "object" &&
            block !== null &&
            "text" in block &&
            typeof (block as TextBlock).text === "string"
          ) {
            texts.push((block as TextBlock).text!);
          }
        }
      }
    }
  }

  return texts.join("\n");
}

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
    const prompt = `
      Du bist ein System Detection Agent.
      Analysiere die folgende URL und bestimme, ob sie zu einem bekannten System gehört.
      Gib ein JSON zurück mit systemType, apiVersion, reachable, confidence, notes.
      URL: ${url}
    `;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
      temperature: 0.2,
    });

    const text = extractText(response.output);
    let result: unknown;

    try {
      result = JSON.parse(text);
    } catch {
      result = { rawOutput: text };
    }

    res.status(200).json({ ok: true, result });
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
