import { AGENT_WORKFLOW_STEPS } from "@/constants/agentWorkflow";
import {
  WORKFLOW_STATE_CACHE_PREFIX,
} from "./migrationDetails.constants";
import type {
  AuthFlowResult,
  AuthFlowStepResult,
  AuthFlowRecommendation,
  CapabilityDiscoveryResult,
  SystemDetectionResult,
  SystemDetectionStepResult,
} from "@/types/agents";
import type { WorkflowBoardState, WorkflowNode } from "@/types/workflow";

export const parseProgressPair = (value: string) => {
  const [current, total] = value.split("/").map((part) => Number(part) || 0);
  return { current, total };
};

export const formatProgressPair = (pair: { current: number; total: number }) => `${pair.current}/${pair.total}`;

const sumCharCodes = (value: string) => value.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);

export const createDefaultWorkflowBoard = (): WorkflowBoardState => {
  const nodes = AGENT_WORKFLOW_STEPS.map((step, index) => ({
    id: step.id,
    title: step.title,
    description: step.description,
    x: 80 + (index % 3) * 280,
    y: 80 + Math.floor(index / 3) * 180,
    color: step.color,
    status: "pending" as const,
    priority: index + 1,
    active: true,
    agentType: step.agentType,
    agentPrompt: "",
    agentResult: undefined,
  }));

  const connections = nodes.slice(0, -1).map((node, index) => ({
    id: `${node.id}-${nodes[index + 1].id}`,
    sourceId: node.id,
    targetId: nodes[index + 1].id,
  }));

  return { nodes, connections };
};

export const serializeWorkflowState = (state: WorkflowBoardState): WorkflowBoardState => ({
  nodes: state.nodes.map((node) => ({ ...node })),
  connections: state.connections.map((connection) => ({ ...connection })),
});

export const deserializeWorkflowState = (payload: unknown): WorkflowBoardState | null => {
  if (!payload) {
    return null;
  }

  try {
    if (typeof payload === "string") {
      const parsed = JSON.parse(payload);
      return deserializeWorkflowState(parsed);
    }

    if (typeof payload !== "object") {
      return null;
    }

    const record = payload as Partial<WorkflowBoardState> & { nodes?: unknown; connections?: unknown };
    if (!Array.isArray(record.nodes)) {
      return null;
    }

    return {
      nodes: record.nodes as WorkflowBoardState["nodes"],
      connections: Array.isArray(record.connections)
        ? (record.connections as WorkflowBoardState["connections"])
        : [],
    };
  } catch (error) {
    console.error("Fehler beim Deserialisieren des Workflow-Status:", error);
    return null;
  }
};

export const getWorkflowStateCacheKey = (migrationId?: string | null) => {
  if (!migrationId) {
    return null;
  }
  return `${WORKFLOW_STATE_CACHE_PREFIX}:${migrationId}`;
};

export const cacheWorkflowStateSnapshot = (migrationId: string | null | undefined, state: WorkflowBoardState) => {
  if (typeof window === "undefined") {
    return;
  }

  const cacheKey = getWorkflowStateCacheKey(migrationId);
  if (!cacheKey) {
    return;
  }

  try {
    const snapshot = serializeWorkflowState(state);
    window.localStorage.setItem(cacheKey, JSON.stringify(snapshot));
  } catch (error) {
    console.error("Fehler beim Zwischenspeichern des Workflow-Status:", error);
  }
};

export const loadCachedWorkflowState = (migrationId: string | null | undefined): WorkflowBoardState | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const cacheKey = getWorkflowStateCacheKey(migrationId);
  if (!cacheKey) {
    return null;
  }

  try {
    const cached = window.localStorage.getItem(cacheKey);
    if (!cached) {
      return null;
    }

    return deserializeWorkflowState(cached);
  } catch (error) {
    console.error("Fehler beim Laden des zwischengespeicherten Workflow-Status:", error);
    return null;
  }
};

export const simulateSourceObjects = (seed: string) => {
  const safeSeed = seed.trim() ? seed : "celion";
  const sum = sumCharCodes(safeSeed);
  const total = 180 + (sum % 420);
  return { current: total, total };
};

export const simulateTargetObjects = (seed: string, sourceTotal: number) => {
  if (sourceTotal <= 0) {
    return { current: 0, total: 0 };
  }

  const safeSeed = seed.trim() ? seed : "celion-target";
  const sum = sumCharCodes(safeSeed);
  const minimumCompletion = Math.floor(sourceTotal * 0.6);
  const variabilityWindow = Math.max(1, Math.floor(sourceTotal * 0.25));
  const deduction = sum % variabilityWindow;
  const current = Math.max(minimumCompletion, sourceTotal - deduction);

  return { current: Math.min(current, sourceTotal), total: sourceTotal };
};

export const clampProgressValue = (value: number) => {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
};

export const normalizeSystemDetectionResult = (input: unknown): SystemDetectionResult | null => {
  if (!input) {
    return null;
  }

  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return normalizeSystemDetectionResult(parsed);
    } catch (error) {
      return null;
    }
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const candidate = input as Partial<SystemDetectionResult>;
  if (typeof candidate.detected !== "boolean") {
    return null;
  }

  const evidence =
    candidate.detection_evidence && typeof candidate.detection_evidence === "object"
      ? (candidate.detection_evidence as SystemDetectionResult["detection_evidence"])
      : {};

  let confidence: number | null = null;
  if (typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)) {
    confidence = candidate.confidence;
  } else if (typeof candidate.confidence === "string") {
    const parsed = Number.parseFloat(candidate.confidence);
    confidence = Number.isFinite(parsed) ? parsed : null;
  }

  return {
    detected: candidate.detected,
    system: candidate.system ?? null,
    api_version: candidate.api_version ?? null,
    confidence,
    base_url: candidate.base_url ?? null,
    detection_evidence: evidence,
    raw_output: candidate.raw_output ?? "",
  };
};

export const normalizeSystemDetectionStepResult = (input: unknown): SystemDetectionStepResult | null => {
  if (!input) {
    return null;
  }

  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return normalizeSystemDetectionStepResult(parsed);
    } catch (error) {
      return null;
    }
  }

  if (typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;
  const source = normalizeSystemDetectionResult(record.source);
  const target = normalizeSystemDetectionResult(record.target);

  if (!source && !target) {
    return null;
  }

  return { source, target };
};

export const detectionMatchesExpectedSystem = (
  detection: SystemDetectionResult | null,
  expectedSystem?: string | null,
): boolean => {
  if (!detection || !detection.detected) {
    return false;
  }

  if (!expectedSystem) {
    return true;
  }

  if (!detection.system) {
    return false;
  }

  const normalizedDetected = detection.system.toLowerCase().trim();
  const normalizedExpected = expectedSystem.toLowerCase().trim();

  if (!normalizedDetected) {
    return false;
  }

  if (!normalizedExpected) {
    return true;
  }

  const expectedKeyword = normalizedExpected.split(" ")[0];
  if (!expectedKeyword) {
    return true;
  }

  return normalizedDetected.includes(expectedKeyword);
};

export const hasSuccessfulSystemDetectionResult = (
  result: WorkflowNode["agentResult"],
  expectedSource?: string | null,
  expectedTarget?: string | null,
): boolean => {
  const combined = normalizeSystemDetectionStepResult(result);

  if (!combined?.source || !combined.target) {
    return false;
  }

  return (
    detectionMatchesExpectedSystem(combined.source, expectedSource) &&
    detectionMatchesExpectedSystem(combined.target, expectedTarget)
  );
};

export const normalizeAuthFlowResult = (input: unknown): AuthFlowResult | null => {
  if (!input) {
    return null;
  }

  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return normalizeAuthFlowResult(parsed);
    } catch (error) {
      return null;
    }
  }

  if (typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const candidate = input as Partial<AuthFlowResult> & {
    recommended_probe?: unknown;
    probe_result?: unknown;
  };

  let recommendedProbe: AuthFlowResult["recommended_probe"] = null;
  if (candidate.recommended_probe && typeof candidate.recommended_probe === "object" && !Array.isArray(candidate.recommended_probe)) {
    const probe = candidate.recommended_probe as unknown as Record<string, unknown>;
    const method = typeof probe.method === "string" && probe.method.trim().length > 0 ? probe.method.trim() : null;
    const url = typeof probe.url === "string" && probe.url.trim().length > 0 ? probe.url.trim() : null;
    const requiresAuth =
      typeof probe.requires_auth === "boolean"
        ? probe.requires_auth
        : probe.requires_auth === undefined
          ? true
          : Boolean(probe.requires_auth);

    const rawApiFormat = typeof probe.api_format === "string" ? probe.api_format.trim().toLowerCase() : null;
    const apiFormat = rawApiFormat === "graphql" || rawApiFormat === "rest_json" ? rawApiFormat : undefined;

    let graphqlConfig: AuthFlowRecommendation["graphql"] = null;
    if (probe.graphql && typeof probe.graphql === "object" && !Array.isArray(probe.graphql)) {
      const graphql = probe.graphql as Record<string, unknown>;
      const query = typeof graphql.query === "string" && graphql.query.trim().length > 0 ? graphql.query.trim() : null;
      const operationName =
        typeof graphql.operation_name === "string" && graphql.operation_name.trim().length > 0
          ? graphql.operation_name.trim()
          : null;
      const variables = graphql.variables && typeof graphql.variables === "object" && !Array.isArray(graphql.variables)
        ? (graphql.variables as Record<string, unknown>)
        : null;

      if (query) {
        graphqlConfig = { query, operation_name: operationName, variables };
      }
    }

    if (method && url) {
      recommendedProbe = {
        method: method.toUpperCase(),
        url,
        requires_auth: requiresAuth,
        ...(apiFormat ? { api_format: apiFormat } : {}),
        graphql: graphqlConfig,
      };
    }
  }

  let probeResult: AuthFlowResult["probe_result"] = null;
  if (candidate.probe_result && typeof candidate.probe_result === "object" && !Array.isArray(candidate.probe_result)) {
    const probe = candidate.probe_result as unknown as Record<string, unknown>;
    const status = typeof probe.status === "number" ? probe.status : null;
    const body = "body" in probe ? (probe.body as unknown) : null;
    const rawResponse = typeof probe.raw_response === "string" ? probe.raw_response : null;
    const error = typeof probe.error === "string" ? probe.error : null;
    const evidence = probe.evidence && typeof probe.evidence === "object" && !Array.isArray(probe.evidence)
      ? (probe.evidence as { request_url?: string; method?: string; used_headers?: string[]; timestamp?: string })
      : { request_url: "", method: "", used_headers: [], timestamp: "" };

    probeResult = {
      status,
      body,
      raw_response: rawResponse,
      error,
      evidence: {
        request_url: typeof evidence.request_url === "string" ? evidence.request_url : "",
        method: typeof evidence.method === "string" ? evidence.method : "",
        used_headers: Array.isArray(evidence.used_headers)
          ? evidence.used_headers.filter((header): header is string => typeof header === "string")
          : [],
        timestamp: typeof evidence.timestamp === "string" ? evidence.timestamp : "",
      },
    };
  }

  const probeStatus = probeResult?.status ?? null;

  const authenticated = typeof candidate.authenticated === "boolean"
    ? candidate.authenticated
    : probeStatus !== null
      ? probeStatus >= 200 && probeStatus < 300
      : null;

  const summary = typeof candidate.summary === "string" && candidate.summary.trim().length > 0
    ? candidate.summary.trim()
    : null;

  return {
    system: typeof candidate.system === "string" ? candidate.system : null,
    base_url: typeof candidate.base_url === "string" ? candidate.base_url : null,
    recommended_probe: recommendedProbe,
    reasoning: typeof candidate.reasoning === "string" ? candidate.reasoning : null,
    probe_result: probeResult,
    authenticated,
    summary,
    error_message: typeof candidate.error_message === "string" ? candidate.error_message : null,
    raw_output: typeof candidate.raw_output === "string" ? candidate.raw_output : "",
  };
};

export const normalizeAuthFlowStepResult = (input: unknown): AuthFlowStepResult | null => {
  if (!input) {
    return null;
  }

  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return normalizeAuthFlowStepResult(parsed);
    } catch (error) {
      return null;
    }
  }

  if (typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;
  const source = normalizeAuthFlowResult(record.source);
  const target = normalizeAuthFlowResult(record.target);

  if (!source && !target) {
    return null;
  }

  return { source, target };
};

export const normalizeCapabilityDiscoveryResult = (
  input: unknown,
): CapabilityDiscoveryResult | null => {
  if (!input || typeof input !== "object") {
    return null;
  }

  const record = input as Partial<CapabilityDiscoveryResult>;

  return {
    api_spec_found: Boolean(record.api_spec_found),
    spec_url: typeof record.spec_url === "string" ? record.spec_url : "",
    entities: Array.isArray(record.entities) ? (record.entities as string[]) : [],
    endpoints: Array.isArray(record.endpoints) ? (record.endpoints as string[]) : [],
    schemas: (record.schemas && typeof record.schemas === "object"
      ? (record.schemas as Record<string, unknown>)
      : {}),
    authentication:
      record.authentication && typeof record.authentication === "object"
        ? (record.authentication as Record<string, unknown>)
        : {},
    pagination:
      record.pagination && typeof record.pagination === "object"
        ? (record.pagination as Record<string, unknown>)
        : {},
    probe_results:
      record.probe_results && typeof record.probe_results === "object"
        ? (record.probe_results as Record<string, unknown>)
        : {},
    limitations: Array.isArray(record.limitations) ? (record.limitations as string[]) : [],
    summary: typeof record.summary === "string" ? record.summary : "",
    raw_output: typeof record.raw_output === "string" ? record.raw_output : null,
  };
};

export const isStepStructuredResult = (
  result: unknown,
): result is SystemDetectionStepResult | AuthFlowStepResult => {
  return Boolean(
    result &&
      typeof result === "object" &&
      ("source" in (result as Record<string, unknown>) || "target" in (result as Record<string, unknown>)),
  );
};

export const confidenceToPercent = (confidence: number | null): number | null => {
  if (confidence === null || !Number.isFinite(confidence)) {
    return null;
  }

  const value = confidence <= 1 ? confidence * 100 : confidence;
  return Math.round(value);
};
