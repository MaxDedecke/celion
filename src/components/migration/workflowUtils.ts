import type { WorkflowNode } from "@/types/workflow";

export const nodeHasAgentResult = (node?: WorkflowNode | null): boolean => {
  if (!node) {
    return false;
  }

  if (node.agentResult === undefined || node.agentResult === null) {
    return false;
  }

  if (typeof node.agentResult === "string") {
    return node.agentResult.trim().length > 0;
  }

  return true;
};
