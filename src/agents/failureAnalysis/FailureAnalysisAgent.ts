import { AgentBase } from '../core/AgentBase';
import { ChatMessage } from '../core/LlmProvider';

export class FailureAnalysisAgent extends AgentBase {
  async execute(params: any): Promise<any> {
    const { stepNumber } = this.context;
    const { agentName, agentLogs, agentError, mode } = params;

    const headerMsg = `Analysiere Fehler in **${agentName}** (${mode || 'system'})...`;
    await this.context.writeChatMessage('assistant', headerMsg, stepNumber);

    const SYSTEM_PROMPT = `
You are a Senior System Reliability Engineer. 
A migration agent has failed. 
Your task is to analyze the 'Agent Logs' and the 'Agent Error' to determine:
1. What exactly went wrong?
2. A theory/explanation of WHY it might be failing (e.g. wrong API version, invalid token format, network restriction).
3. Suggestions for the user to fix it.

Be professional, slightly dry (IT-humor is allowed), and helpful.
Answer in German.

Format your response in Markdown. Use bold for key terms.
`;

    const userContext = `
Agent Name: ${agentName}
Agent Error: ${agentError}
Agent Logs: ${JSON.stringify(agentLogs)}
    `;

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContext }
    ];

    const response = await this.provider.chat(messages, [], { 
        model: process.env.OPENAI_MODEL || "gpt-4o"
    });

    if (response.content) {
      await this.context.writeChatMessage('assistant', response.content, stepNumber);
      return { analysis: response.content };
    } else {
      return { error: 'No analysis produced' };
    }
  }
}
