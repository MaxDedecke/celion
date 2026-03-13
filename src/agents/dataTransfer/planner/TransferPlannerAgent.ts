import { AgentBase, AgentContext } from '../../core/AgentBase';
import { LlmProvider, ChatMessage, Tool } from '../../core/LlmProvider';
import { ExecutionPlan } from '../state/types';

export interface PlannerParams {
  mappingRules: any[];
  sourceSchema: any;
  targetSchema: any;
  sourceEntities: any[]; // e.g., ["users", "status", "tickets"]
  targetEntities: any[];
}

export class TransferPlannerAgent extends AgentBase {
  constructor(provider: LlmProvider, context: AgentContext) {
    super(provider, context);
  }

  async execute(params: PlannerParams): Promise<ExecutionPlan> {
    const systemPrompt = `Du bist der "Execution Planner" für eine Datenmigration.
Deine Aufgabe ist es, einen strikten, sequenziellen und abhängigkeitsbasierten Ausführungsplan (Execution Plan) zu generieren.

### DEIN INPUT:
- Quell-Schema & Ziel-Schema (Entitäten und Felder)
- Mapping-Regeln (wie Entitäten gemappt werden)
- Relevante Entitäten (welche Objekte überhaupt migriert werden sollen)

### DEIN OUTPUT (JSON via Tool Call):
Erstelle einen \`ExecutionPlan\`, der aus mehreren \`ExecutionTask\`s besteht.
Jeder Task muss:
1.  Ein klares Ziel haben (z.B. "Migriere alle User", "Migriere alle Jira Status nach Asana Rubriken").
2.  Die korrekte \`sourceEntityType\` und \`targetEntityType\` angeben.
3.  Die \`dependsOn\` Liste pflegen: Ein Task, der Status-Mappings in Tickets benutzt, MUSS von der Status-Migration abhängen! (Tickets brauchen oft User und Status).
4.  Eine eindeutige ID (\`id\`) bekommen.
5.  Status initial auf "pending" und retries auf 0.

### REGELN:
- Referenziere in \`dependsOn\` exakt die \`id\`s der anderen Tasks.
- Vermeide zyklische Abhängigkeiten (A hängt von B ab, B von A).
- Versuche, grundlegende Entitäten (wie User, Status, Labels, Kategorien, Prioritäten) zuerst zu migrieren, bevor Haupt-Entitäten (wie Tickets, Issues, Tasks) migriert werden.
- **WICHTIG:** Fasse ALLE Mappings, die das gleiche Paar aus \`sourceEntityType\` und \`targetEntityType\` betreffen, in einem EINZIGEN Task zusammen. Wenn du z.B. Felder wie Name, Status und Datum von 'task' nach 'page' mappst, darf es nur EINEN Task dafür geben (z.B. 'migrate_tasks_to_pages'). Erstelle NIEMALS separate Tasks für Eigenschaften derselben Entität!
- Nutze ausschließlich das Tool 'generate_plan' und gib die Struktur als JSON zurück.`;

    const userPrompt = `
Hier sind die Daten für die Migration:

### ZU MIGRIERENDE QUELL-ENTITÄTEN:
${JSON.stringify(params.sourceEntities, null, 2)}

### ZU MIGRIERENDE ZIEL-ENTITÄTEN:
${JSON.stringify(params.targetEntities, null, 2)}

### MAPPING-REGELN:
${JSON.stringify(params.mappingRules, null, 2)}

Erstelle einen logischen Ausführungsplan für diese Migration.`;

    const generatePlanTool: Tool = {
      type: "function",
      function: {
        name: "generate_plan",
        description: "Generiert den Ausführungsplan für die Migration.",
        parameters: {
          type: "object",
          properties: {
            tasks: {
              type: "array",
              description: "Die Liste der Aufgaben in der korrekten Ausführungsreihenfolge.",
              items: {
                type: "object",
                properties: {
                  id: { type: "string", description: "Eindeutige ID des Tasks (z.B. 'migrate_status')" },
                  description: { type: "string", description: "Beschreibung, was dieser Task tut." },
                  sourceEntityType: { type: "string", description: "Name der Quell-Entität (z.B. 'status')" },
                  targetEntityType: { type: "string", description: "Name der Ziel-Entität (z.B. 'rubrik')" },
                  dependsOn: { 
                    type: "array", 
                    items: { type: "string" },
                    description: "Liste der Task-IDs, die vorher erfolgreich abgeschlossen sein müssen."
                  },
                },
                required: ["id", "description", "sourceEntityType", "targetEntityType", "dependsOn"]
              }
            }
          },
          required: ["tasks"]
        }
      }
    };

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];

    try {
      const response = await this.provider.chat(messages, [generatePlanTool], { 
        temperature: 0.1,
        tool_choice: { type: "function", function: { name: "generate_plan" } }
      });

      if (response.toolCalls && response.toolCalls.length > 0) {
        const toolCall = response.toolCalls.find(tc => tc.function.name === 'generate_plan');
        if (toolCall) {
          const planArgs = JSON.parse(toolCall.function.arguments);
          
          // Map to ExecutionPlan type
          const executionPlan: ExecutionPlan = {
            tasks: planArgs.tasks.map((task: any) => ({
              ...task,
              status: "pending",
              retries: 0
            }))
          };

          return executionPlan;
        }
      }

      throw new Error("Der Agent hat keinen Plan generiert.");
    } catch (error: any) {
      console.error("TransferPlannerAgent Error:", error);
      throw new Error(`Planung fehlgeschlagen: ${error.message}`);
    }
  }
}
