export class AgentExecutionError extends Error {
  agentResult?: unknown;

  constructor(message: string, agentResult?: unknown) {
    super(message);
    this.name = "AgentExecutionError";
    this.agentResult = agentResult;
  }
}
