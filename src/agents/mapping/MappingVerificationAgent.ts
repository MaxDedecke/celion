import { AgentBase } from '../core/AgentBase';
import { ChatMessage } from '../core/LlmProvider';
import { loadObjectScheme, loadScheme } from '../../lib/scheme-loader';
import { TransferPlannerAgent } from '../dataTransfer/planner/TransferPlannerAgent';

export class MappingVerificationAgent extends AgentBase {
  async execute(params: any): Promise<any> {
    const { stepNumber, migrationId, dbPool } = this.context;
    
    if (!dbPool) {
        return { success: false, error: "Database pool not provided in context", isLogicalFailure: true };
    }

    const migrationDetails = await this.context.getMigrationDetails();
    const scopeConfig = migrationDetails?.scope_config || {};

    const { rows: migRows6 } = await dbPool.query('SELECT source_system, target_system FROM migrations WHERE id = $1', [migrationId]);
    const sSys6 = migRows6[0]?.source_system;
    const tSys6 = migRows6[0]?.target_system;

    if (!sSys6 || !tSys6) {
        return { success: false, error: 'Systemkonfiguration unvollständig.', isLogicalFailure: true };
    }

    const { rows: s3Rows6 } = await dbPool.query('SELECT entity_name, count, is_ignored FROM step_3_results WHERE migration_id = $1', [migrationId]);
    
    // Phase 1: Planning (If no plan exists yet)
    if (!scopeConfig.execution_plan) {
        console.log(`[MappingVerificationAgent] Phase 1: Generating Execution Plan for migration ${migrationId}`);
        await this.context.writeChatMessage('assistant', 'Erstelle initialen Ausführungsplan (Phase 1)...', stepNumber);
        
        const sourceSchema = await loadScheme(sSys6);
        const targetSchema = await loadScheme(tSys6);
        
        const sourceEntitiesList = s3Rows6.map((r: any) => r.entity_name);
        const targetObjectSpecs = await loadObjectScheme(tSys6);
        const targetEntitiesList = targetObjectSpecs ? targetObjectSpecs.objects.map((o: any) => o.key) : [];

        const planner = new TransferPlannerAgent(this.provider, this.context);
        try {
            const plan = await planner.execute({
                sourceSchema,
                targetSchema,
                sourceEntities: sourceEntitiesList,
                targetEntities: targetEntitiesList
            });

            const updatedScopeConfig = { ...scopeConfig, execution_plan: plan };
            await dbPool.query('UPDATE migrations SET scope_config = $1 WHERE id = $2', [JSON.stringify(updatedScopeConfig), migrationId]);

            const message = `Ich habe einen **Ausführungsplan** für die Migration entworfen.\n\nFolgende Schritte sind vorgesehen:\n${plan.tasks.map(t => `- **${t.description}** (${t.sourceEntityType} ➔ ${t.targetEntityType})`).join('\n')}\n\nBitte prüfe den Plan im Chat. Wenn du Änderungswünsche hast, teile sie mir mit. Wenn alles passt, bestätige den Plan und wechsle in den "Mappings"-Tab (oben rechts), um die Mapping-Regeln zu erstellen.`;
            
            const actionContent = JSON.stringify({
                type: "action",
                actions: [
                  { action: "open-mapping-ui", label: "Plan bestätigen", variant: "primary" }
                ]
            });

            await this.context.writeChatMessage('assistant', message, stepNumber);
            await this.context.writeChatMessage('system', actionContent, stepNumber);

            return { isEarlyReturnForPlan: true, success: true, result: plan };
        } catch (error: any) {
            return { success: false, error: `Plan-Generierung fehlgeschlagen: ${error.message}`, isLogicalFailure: true };
        }
    }

    console.log(`[MappingVerificationAgent] Running Mapping Verification for migration ${migrationId}`);
    await this.context.writeChatMessage('assistant', 'Verifiziere Mapping-Konfiguration auf Basis des Plans...', stepNumber);

    const { rows: ruleRows6 } = await dbPool.query('SELECT * FROM public.mapping_rules WHERE migration_id = $1', [migrationId]);

    const sourceSpecs = await loadObjectScheme(sSys6);
    const targetSpecs = await loadObjectScheme(tSys6);

    if (!sourceSpecs || !targetSpecs) {
        return { success: false, error: 'Objektspezifikationen konnten nicht geladen werden.', isLogicalFailure: true };
    }

    const SYSTEM_PROMPT = `
Du bist ein Mapping Verification Agent. Deine Aufgabe ist es, die bestehenden Mapping-Regeln für eine Migration zu überprüfen.

### DEINE ZIELE:
1. **Fokus auf den Ausführungsplan:** Der bereitgestellte Execution Plan ist deine absolute Referenz. Er definiert, welche Übertragungen (Tasks) geplant sind.
   - Prüfe für **jeden Task** im Plan, ob passende Mapping-Regeln existieren.
   - Ein Task (z.B. source: 'workspace' -> target: 'spaces') gilt als abgedeckt, wenn es mindestens eine Mapping-Regel für dieses Paar gibt.
   - **WICHTIG:** Sei tolerant bei Plural/Singular (z.B. 'task' vs 'tasks', 'space' vs 'spaces', 'folder' vs 'folders'). Wenn der Plan 'tasks' sagt und die Regel 'task', ist das korrekt.
   - **WICHTIG:** Sei tolerant bei Benennungen (z.B. 'lists_in_folders' oder 'sections' im Plan vs 'list' or 'section' in den Regeln). Wenn das Zielobjekt im Kern das gleiche ist, akzeptiere es.
   - **SPEZIALFALL ASANA:** Akzeptiere 'project_tasks' im Plan als Abdeckung durch 'task' Regeln (und umgekehrt).
2. **Keine User-Migration:** Celion migriert KEINE Benutzer. Falls im Plan ein Task zur Migration von Benutzern (User, Member, Assignee) steht, IGNORE diesen Task komplett. Er gilt als "nicht relevant für die Verifizierung".
3. **Validität & Semantik:** Bewerte, ob die Mappings semantisch sinnvoll sind.
   - **IGNORE-Regeln:** Eine 'IGNORE' Regel für ein Quell-Feld ist eine gültige Zuordnung.
4. **Pflichtfelder:** Prüfe, ob kritische Felder (wie 'Name' oder 'Title') gemappt sind.

### FEHLERMELDUNG:
Falls ein Task aus dem Plan (der kein User-Task ist) nicht durch Mappings abgedeckt ist:
- Gib in \`missing_entities\` die **Beschreibung** des Tasks (z.B. "Migration von Projekten") an.
- Erkläre in der \`summary\` genau, welches Paar (Source -> Target) laut Plan fehlt.

### OUTPUT FORMAT:
Antworte ausschließlich mit einem validen JSON-OBjekt im folgenden Format:
{
  "verification_report": {
    "is_complete": boolean,
    "missing_entities": ["string"],
    "rule_analysis": [
      {
        "rule_id": "string",
        "status": "valid" | "warning" | "error",
        "message": "string"
      }
    ],
    "target_readiness": {
      "score": number,
      "missing_required_fields": []
    }
  },
  "summary": "Detaillierte deutsche Zusammenfassung."
}
    `;

    const userContext = `
Ausführungsplan (Execution Plan):
${JSON.stringify(scopeConfig.execution_plan, null, 2)}

Existing Mapping Rules:
${JSON.stringify(ruleRows6, null, 2)}

Source Object Specs (${sourceSpecs.system}):
${JSON.stringify(sourceSpecs.objects, null, 2)}

Target Object Specs (${targetSpecs.system}):
${JSON.stringify(targetSpecs.objects, null, 2)}
    `;

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContext }
    ];

    const response = await this.provider.chat(messages, undefined, { 
        model: process.env.OPENAI_MODEL || "gpt-4o",
        response_format: { type: "json_object" } 
    });

    const messageContent = response.content;

    if (messageContent) {
      try {
        const parsed = JSON.parse(messageContent);
        let isLogicalFailure = false;
        let failureMessage = "";
        
        if (parsed.verification_report && parsed.verification_report.is_complete === false) {
          isLogicalFailure = true;
          failureMessage = "Mapping ist unvollständig.";
        }
        
        return {
            success: !isLogicalFailure,
            result: parsed,
            isLogicalFailure,
            error: failureMessage
        };
      } catch (e) {
        return {
            success: false,
            result: { text: messageContent },
            isLogicalFailure: true,
            error: "Agent lieferte kein gültiges JSON Ergebnis."
        };
      }
    } else {
      return {
          success: false,
          result: { error: 'Verification agent produced no output' },
          isLogicalFailure: true,
          error: "Verification agent produced no output."
      };
    }
  }
}
