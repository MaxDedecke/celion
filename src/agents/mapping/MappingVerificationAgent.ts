import { AgentBase } from '../core/AgentBase';
import { ChatMessage } from '../core/LlmProvider';
import { loadObjectScheme } from '../../lib/scheme-loader';

export class MappingVerificationAgent extends AgentBase {
  async execute(params: any): Promise<any> {
    const { stepNumber, migrationId, dbPool } = this.context;
    
    if (!dbPool) {
        return { success: false, error: "Database pool not provided in context", isLogicalFailure: true };
    }

    console.log(`[MappingVerificationAgent] Running Mapping Verification for migration ${migrationId}`);
    await this.context.writeChatMessage('assistant', 'Verifiziere Mapping-Konfiguration...', stepNumber);

    const { rows: migRows6 } = await dbPool.query('SELECT source_system, target_system FROM migrations WHERE id = $1', [migrationId]);
    const sSys6 = migRows6[0]?.source_system;
    const tSys6 = migRows6[0]?.target_system;

    if (!sSys6 || !tSys6) {
        return { success: false, error: 'Systemkonfiguration unvollständig.', isLogicalFailure: true };
    }

    const { rows: s3Rows6 } = await dbPool.query('SELECT entity_name, count, is_ignored FROM step_3_results WHERE migration_id = $1', [migrationId]);
    const userRelatedTerms = ['user', 'member', 'participant', 'assignee', 'owner', 'creator', 'author', 'collaborator'];
    const sourceEntities = s3Rows6
      .map((r: any) => ({ name: r.entity_name, count: r.count, isIgnored: r.is_ignored }))
      .filter((ent: any) => {
        const nameLower = ent.name.toLowerCase();
        const isUserRelated = userRelatedTerms.some(term => nameLower.includes(term));
        return ent.count > 0 && !isUserRelated;
      });

    const { rows: ruleRows6 } = await dbPool.query('SELECT * FROM public.mapping_rules WHERE migration_id = $1', [migrationId]);

    const sourceSpecs = await loadObjectScheme(sSys6);
    const targetSpecs = await loadObjectScheme(tSys6);

    if (!sourceSpecs || !targetSpecs) {
        return { success: false, error: 'Objektspezifikationen konnten nicht geladen werden.', isLogicalFailure: true };
    }

    const SYSTEM_PROMPT = `
Du bist ein Mapping Verification Agent. Deine Aufgabe ist es, die bestehenden Mapping-Regeln für eine Migration zu überprüfen.

### DEINE ZIELE:
1. **Fokus auf Inventar (Schritt 3) & Semantische Zuordnung:** Beziehe dich auf die in "Source Entities" aufgeführten Entitäten.
   - **WICHTIG:** Ein Inventar-Item (z.B. "Project Tasks" oder "Task Details") gilt als VOLLSTÄNDIG gemappt, wenn entsprechende Regeln für den zugehörigen technischen Objekt-Key (z.B. "task") in den Mapping Rules existieren.
   - Nutze die "Source Object Specs", um herauszufinden, welches technische Objekt zu welchem Inventar-Item passt (z.B. über Namensähnlichkeit oder DisplayName).
   - Melde fehlende Mappings NUR, wenn für eine Entität aus dem Inventar WEDER unter ihrem Namen NOCH unter ihrem technischen Key (laut Specs) Regeln existieren.
   - Ignoriere alle Entitäten, die NICHT in "Source Entities" enthalten sind oder dort einen Count von 0 haben (diese wurden bereits vorab gefiltert).
2. **Keine User-Migration:** Es werden KEINE User, Member, Assignees oder Collaborators migriert. 
   - Ignoriere alle Regeln oder Objekte, die sich auf User/Accounts beziehen. Schaue nicht nach User-Mappings.
3. **Vollständigkeit:** Prüfe, ob für alle im Inventar gefundenen Entitäten (direkt oder über ihren technischen Key) entsprechende Mapping-Regeln existieren.
   - **WICHTIG:** Ignorierte Entitäten (isIgnored: true) müssen NICHT gemappt werden.
4. **Validität & Semantik:** Bewerte, ob die Mappings semantisch sinnvoll sind.
   - Prüfe Datentypen: Passt ein "date" Feld zu einer "id" (wahrscheinlich nicht)?
   - **IGNORE-Regeln:** Wenn eine Regel den Typ 'IGNORE' hat, ist dies eine gültige Zuordnung.
5. **Pflichtfelder:** Prüfe, ob alle Pflichtfelder im Zielsystem abgedeckt werden (für die Objekte, für die Mappings existieren).

### INPUTS:
- **Source Entities:** Relevantes Inventar aus Schritt 3 (bereits gefiltert: nur count > 0, keine User).
- **Mapping Rules:** Die aktuell definierten Regeln.
- **Source Object Specs:** Feldspezifikationen des Quellsystems.
- **Target Object Specs:** Feldspezifikationen des Zielsystems.

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
      "score": number, // 0-100
      "missing_required_fields": [
        {
          "targetEntity": "string",
          "field": "string"
        }
      ]
    }
  },
  "summary": "Detaillierte deutsche Zusammenfassung. Konzentriere dich auf echte semantische Fehler oder fehlende Pflichtfelder für die relevanten Entitäten."
}
    `;

    const userContext = `
Source Entities (Inventory):
${JSON.stringify(sourceEntities, null, 2)}

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

    const messageContent = response.choices[0].message.content;

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
