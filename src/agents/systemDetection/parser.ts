// src/agents/systemDetection/parser.ts

import { extractJson } from "../openai/message";

export const parseSystemDetectionResponse = (text: string) => {
  const jsonStr = extractJson(text);
  return JSON.parse(jsonStr);
};
