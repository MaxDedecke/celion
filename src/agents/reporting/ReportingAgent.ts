import { AgentBase } from '../core/AgentBase';
import { ChatMessage } from '../core/LlmProvider';

export class ReportingAgent extends AgentBase {
  async execute(params: any): Promise<any> {
    const { migrationId } = this.context;
    const pool = this.context.dbPool;

    await this.context.logActivity('info', 'Generiere Abschlussbericht...');
    await this.context.writeChatMessage('assistant', 'Ich stelle nun alle Daten der Migration zusammen und erstelle deinen detaillierten Abschlussbericht. Einen Moment bitte...', this.context.stepNumber);

    try {
      // 1. Fetch Migration Details
      const { rows: migRows } = await pool.query(
        'SELECT name, source_system, target_system, source_url, target_url, created_at, updated_at FROM migrations WHERE id = $1',
        [migrationId]
      );
      const migration = migRows[0];

      // 2. Fetch all Step Results
      const { rows: stepRows } = await pool.query(
        'SELECT workflow_step_id, name, status, result, created_at FROM migration_steps WHERE migration_id = $1 ORDER BY created_at ASC',
        [migrationId]
      );

      // 3. Fetch Mapping Rules
      const { rows: mappingRows } = await pool.query(
        'SELECT source_object, source_property, target_object, target_property, rule_type, enhancements FROM mapping_rules WHERE migration_id = $1',
        [migrationId]
      );

      // 4. Fetch Transfer Logs (Stats)
      const { rows: transferStats } = await pool.query(
        `SELECT 
            entity_type, 
            COUNT(*) FILTER (WHERE status = 'success') as success_count,
            COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
            array_agg(error_message) FILTER (WHERE status = 'failed' AND error_message IS NOT NULL) as errors
         FROM transfer_logs 
         WHERE migration_id = $1 
         GROUP BY entity_type`,
        [migrationId]
      );

      // 5. Fetch Activities
      const { rows: activityRows } = await pool.query(
        'SELECT type, title, timestamp FROM migration_activities WHERE migration_id = $1 ORDER BY created_at ASC',
        [migrationId]
      );

      // Construct Structured Report Data
      const reportData = {
        type: 'migration_report',
        migrationInfo: migration,
        steps: stepRows,
        mappings: mappingRows,
        transferStats: transferStats,
        activities: activityRows,
        generatedAt: new Date().toISOString()
      };

      // Use LLM to generate a narrative summary
      const systemPrompt = `Du bist der Celion Reporting Agent. Deine Aufgabe ist es, eine professionelle Zusammenfassung der Migration zu schreiben.
      Nutze die bereitgestellten Daten, um Erfolge hervorzuheben und auf eventuelle Probleme (Fehler beim Transfer) hinzuweisen.
      
      Migration: ${migration.name} (${migration.source_system} -> ${migration.target_system})
      Statistiken: ${JSON.stringify(transferStats)}
      
      Schreibe eine kurze, prägnante Zusammenfassung (max. 3-4 Sätze).`;

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Generiere die Zusammenfassung für den Bericht.' }
      ];

      const response = await this.provider.chat(messages, [], { temperature: 0.3 });
      const narrative = response.content;

      // Final Report Object
      const finalReport = {
        ...reportData,
        summary: narrative
      };

      // Send the summary and structured report as a SINGLE assistant message.
      // The UI will extract the JSON from the markdown block and render the ReportDisplay component.
      await this.context.writeChatMessage('assistant', `${narrative}\n\n\`\`\`json\n${JSON.stringify(finalReport)}\n\`\`\``, this.context.stepNumber);

      return {
        success: true,
        result: finalReport
      };

    } catch (error: any) {
      console.error('[ReportingAgent] Error generating report:', error);
      await this.context.logActivity('error', `Fehler beim Generieren des Berichts: ${error.message}`);
      return {
        success: false,
        error: error.message
      };
    }
  }
}
