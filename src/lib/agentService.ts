import type { SystemDetectionResult } from "@/types/agents";

const DEFAULT_AGENT_SERVICE_URL = "http://localhost:8000";

const resolveServiceUrl = () => {
  const configured = import.meta.env.VITE_AGENT_SERVICE_URL as string | undefined;
  const baseUrl = (configured && configured.trim()) || DEFAULT_AGENT_SERVICE_URL;
  return baseUrl.replace(/\/$/, "");
};

type AgentExecutionOptions = {
  signal?: AbortSignal;
};

export const runSystemDetectionAgent = async (
  url: string,
  options: AgentExecutionOptions = {}
): Promise<SystemDetectionResult> => {
  if (!url || !url.trim()) {
    throw new Error("Es wurde keine gültige URL für die Systemerkennung angegeben.");
  }

  const serviceUrl = resolveServiceUrl();
  const response = await fetch(`${serviceUrl}/agents/system-detection`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
    signal: options.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Agent-Service antwortete mit Status ${response.status}${
        errorText ? `: ${errorText}` : ""
      }`
    );
  }

  const payload = (await response.json()) as Partial<SystemDetectionResult>;

  const detectionEvidence =
    (payload.detection_evidence && typeof payload.detection_evidence === "object")
      ? payload.detection_evidence
      : {};

  let confidence: number | null = null;
  if (typeof payload.confidence === "number" && Number.isFinite(payload.confidence)) {
    confidence = payload.confidence;
  } else if (typeof payload.confidence === "string") {
    const parsed = Number.parseFloat(payload.confidence);
    confidence = Number.isFinite(parsed) ? parsed : null;
  }

  return {
    detected: Boolean(payload.detected),
    system: payload.system ?? null,
    api_version: payload.api_version ?? null,
    confidence,
    base_url: payload.base_url ?? null,
    detection_evidence: detectionEvidence,
    raw_output: payload.raw_output ?? "",
  };
};

