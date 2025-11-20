// src/agents/agentService.ts

import { runSystemDetection } from "./systemDetection/runSystemDetection";
import { runAuthFlow } from "./authFlow/runAuthFlow";
import { runCapabilityDiscovery } from "./capabilityDiscovery/runCapabilityDiscovery";

export const runSystemDetectionAgent = runSystemDetection;
export const runAuthFlowAgent = runAuthFlow;
export const runCapabilityDiscoveryAgent = runCapabilityDiscovery;
