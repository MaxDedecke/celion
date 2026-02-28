import { AgentBase } from '../core/AgentBase';
import { runEnhancementRules } from '../enhancementRules/runEnhancementRules';

export class EnhancementRulesAgent extends AgentBase {
  async execute(params: any): Promise<any> {
    const { migrationId, dbPool } = this.context;
    
    if (!dbPool) {
        return { success: false, error: "Database pool not provided in context", isLogicalFailure: true };
    }

    console.log(`[EnhancementRulesAgent] Executing runEnhancementRules for migration ${migrationId}`);
    const userMessage = params?.userMessage;
    const contextParams = params?.context;

    const messageGenerator = runEnhancementRules(userMessage, {
        ...contextParams,
        migrationId
    });

    let messageCount = 0;
    for await (const message of messageGenerator) {
      console.log(`[EnhancementRulesAgent] yielded message ${++messageCount}`);
      if (message.content && message.content.length > 0 && message.content[0].text) {
        // writeMappingChatMessage logic equivalent
        await dbPool.query(
            'INSERT INTO mapping_chat_messages (migration_id, role, content) VALUES ($1, $2, $3)',
            [migrationId, 'assistant', message.content[0].text]
        );
      }
    }
    console.log(`[EnhancementRulesAgent] completed with ${messageCount} messages`);

    return {
        success: true,
        result: { messageCount },
        isLogicalFailure: false
    };
  }
}
