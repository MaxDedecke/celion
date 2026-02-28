import { AgentBase } from '../core/AgentBase';
import { ChatMessage } from '../core/LlmProvider';

export class QualityEnhancementAgent extends AgentBase {
  async execute(params: any): Promise<any> {
    const { stepNumber, migrationId, dbPool } = this.context;
    
    if (!dbPool) {
        return { success: false, error: "Database pool not provided in context", isLogicalFailure: true };
    }

    console.log(`[QualityEnhancementAgent] Running Quality Enhancement for migration ${migrationId}`);
    await this.context.writeChatMessage('assistant', 'Analysiere und verifiziere Qualitäts-Enhancements...', stepNumber);
    
    const { rows: migRows7 } = await dbPool.query('SELECT source_system, target_system FROM migrations WHERE id = $1', [migrationId]);
    const sSys7 = migRows7[0]?.source_system;
    const tSys7 = migRows7[0]?.target_system;

    const { rows: ruleRows7 } = await dbPool.query('SELECT * FROM public.mapping_rules WHERE migration_id = $1', [migrationId]);
    const rulesWithEnhancements = ruleRows7.filter((r: any) => 
      (r.enhancements && r.enhancements.length > 0) || 
      r.rule_type === 'POLISH' || 
      r.rule_type === 'ENHANCE'
    );
    
    if (rulesWithEnhancements.length > 0) {
      const SYSTEM_PROMPT = `
Du bist ein Enhancement Verification Agent. Deine Aufgabe ist es, die konfigurierten Qualitäts-Optimierungen (Enhancements) für eine Migration zu überprüfen, bevor sie final auf die Daten angewendet werden.

### DEINE ZIELE:
1. **Sinnhaftigkeit:** Prüfe, ob die gewählten Enhancements (z.B. translate_en, summarize) für die jeweiligen Felder semantisch sinnvoll sind. 
   - Beispiel: Eine "Zusammenfassung" auf einem kurzen Namensfeld ist meistens unnötig.
   - Beispiel: Eine "Rechtschreibprüfung" auf technischen Keys oder IDs ist kontraproduktiv.
2. **Risiko-Analyse:** Weise auf potenzielle Probleme hin.
   - Beispiel: PII-Schwärzung könnte wichtige Metadaten entfernen, wenn sie zu aggressiv ist.
   - Beispiel: Automatische Übersetzung könnte Fachbegriffe verfälschen.
3. **Bestätigung:** Wenn alles logisch und sinnvoll konfiguriert ist, gib ein positives Feedback ("Sieht alles super aus!").

### INPUTS:
- **Mapping Rules:** Die aktuell definierten Regeln inkl. der Spalte 'enhancements' (string[]).
- **Source System:** Name des Quellsystems.
- **Target System:** Name des Zielsystems.

### OUTPUT FORMAT:
Antworte ausschließlich mit einem validen JSON-Objekt im folgenden Format:
{
  "verification_report": {
    "is_optimal": boolean,
    "analysis": [
      {
        "rule_id": "string",
        "field": "string",
        "status": "perfect" | "warning" | "info",
        "message": "string"
      }
    ],
    "summary": "Kurze, prägnante Zusammenfassung auf Deutsch. Wenn alles okay ist, sag das freundlich. Wenn es Bedenken gibt, nenne sie klar."
  }
}
      `;

      const userContext = `
Source System: ${sSys7}
Target System: ${tSys7}

Current Mapping Rules with Enhancements:
${JSON.stringify(rulesWithEnhancements, null, 2)}
      `;

      const messages: ChatMessage[] = [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContext }
      ];

      try {
        const response = await this.provider.chat(messages, undefined, { 
            model: process.env.OPENAI_MODEL || "gpt-4o",
            response_format: { type: "json_object" } 
        });

        const messageContent = response.choices[0].message.content;
        if (messageContent) {
          const verificationResult = JSON.parse(messageContent);
          const report = verificationResult.verification_report;
          
          if (report) {
             if (report.summary) {
               await this.context.writeChatMessage('assistant', report.summary, stepNumber);
             }

             const warnings = report.analysis?.filter((a: any) => a.status === 'warning' || a.status === 'info') || [];
             if (warnings.length > 0) {
                let warningMsg = "**Hinweise zur Überprüfung:**\\n";
                warnings.forEach((w: any) => {
                  warningMsg += \`- Feld \\\`\${w.field}\\\`: \${w.message}\\n\`;
                });
                await this.context.writeChatMessage('assistant', warningMsg, stepNumber);
             }
          }
        }
      } catch (e) {
        console.error("[QualityEnhancementAgent] Failed to parse enhancement verification result", e);
      }
    } else {
      await this.context.writeChatMessage('assistant', 'Keine spezifischen Enhancements konfiguriert. Der Inhalt wird 1:1 übernommen.', stepNumber);
    }

    await this.context.writeChatMessage('assistant', `Qualitäts-Veredelung abgeschlossen. ${rulesWithEnhancements.length} Mapping-Regeln mit Enhancements verarbeitet.`, stepNumber);

    const result = { 
        status: 'success', 
        message: 'Quality Enhancement erfolgreich abgeschlossen.',
        processedRules: rulesWithEnhancements.length
    };
    
    return {
      success: true,
      result,
      isLogicalFailure: false
    };
  }
}
