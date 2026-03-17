import { AgentBase, AgentContext } from '../../core/AgentBase';
import { LlmProvider } from '../../core/LlmProvider';
import { ExecutionTask, OrchestratorState, ExecutionPlan } from '../state/types';
import { TransferPlannerAgent } from '../planner/TransferPlannerAgent';
import { TaskSubagent } from '../worker/TaskSubagent';

export class OrchestratorAgent extends AgentBase {
  private state!: OrchestratorState;
  private readonly MAX_AGENT_RUNS = 20;

  constructor(provider: LlmProvider, context: AgentContext) {
    super(provider, context);
  }

  async execute(params: {
    migrationId: string,
    initialPlan?: ExecutionPlan,
    mappingRules: any[],
    sourceSchema: any,
    targetSchema: any,
    sourceEntities: any[],
    targetEntities: any[],
    sourceSystem: string,
    targetSystem: string,
    targetScopeId: string,
    sourceScopeIds?: string[],
    stepNumber: number
  }): Promise<void> {
    await this.context.logActivity('info', `[Orchestrator] Starting orchestration for migration ${params.migrationId}`);

    // 1. Initialize or Load State
    this.state = await this.loadOrInitializeState(params);

    const planSummary = this.state.plan.tasks.map(t => `- **${t.id}**: ${t.description} (${t.status})`).join('\n');
    await this.context.writeChatMessage('assistant', `📍 **Ausführungsplan bereit:**\n${planSummary}`, params.stepNumber);

    if (!this.hasPendingTasks()) {
      await this.context.logActivity('info', '[Orchestrator] All tasks completed or no pending tasks. Orchestration finished.');
      return;
    }

    // 2. Main Execution Loop
    while (this.hasPendingTasks() && this.state.totalAgentRuns < this.MAX_AGENT_RUNS) {
      const nextTask = this.getNextReadyTask();

      if (!nextTask) {
        const errorMsg = 'Deadlock detected: There are pending tasks, but none have their dependencies met.';
        await this.context.logActivity('error', errorMsg);
        await this.context.writeChatMessage('assistant', `⚠️ **Orchestrator Fehler:** Sackgasse erkannt. Es gibt noch Aufgaben, aber Abhängigkeiten sind nicht erfüllt.`, params.stepNumber);
        throw new Error(errorMsg);
      }

      const taskMsg = `🚀 **Starte Teilaufgabe:** ${nextTask.description} (${nextTask.sourceEntityType} ➡️ ${nextTask.targetEntityType})`;
      await this.context.logActivity('info', `[Orchestrator] Starting task: ${nextTask.description} (${nextTask.id})`);
      const taskChatId = await this.context.writeChatMessage('assistant', taskMsg, params.stepNumber);
      
      nextTask.status = 'in_progress';
      await this.saveState(); // Persist progress

      let taskSuccess = false;
      const MAX_RETRIES = 3;

      while (!taskSuccess && nextTask.retries < MAX_RETRIES) {
        this.state.totalAgentRuns++;
        
        if (this.state.totalAgentRuns > this.MAX_AGENT_RUNS) {
           const errorMsg = 'Circuit Breaker triggered: Maximum agent runs exceeded.';
           await this.context.logActivity('error', errorMsg);
           await this.context.writeChatMessage('assistant', `🛑 **Transfer abgebrochen:** Maximale Anzahl an Agenten-Durchläufen (${this.MAX_AGENT_RUNS}) überschritten.`, params.stepNumber);
           throw new Error(errorMsg);
        }

        if (nextTask.retries > 0) {
            await this.context.writeChatMessage('assistant', `🔄 Wiederhole Aufgabe "${nextTask.id}" (Versuch ${nextTask.retries + 1}/${MAX_RETRIES})...`, params.stepNumber);
        }

        try {
          // Instantiate and run the specialized Subagent
          const subagent = new TaskSubagent(this.provider, this.context);
          const subagentResult = await subagent.execute({
            task: nextTask,
            mappingRules: params.mappingRules,
            idMappings: this.state.idMappings,
            sourceSchema: params.sourceSchema,
            targetSchema: params.targetSchema,
            sourceSystem: params.sourceSystem,
            targetSystem: params.targetSystem,
            targetScopeId: params.targetScopeId
          });

          if (!subagentResult.success) {
            throw new Error(subagentResult.error || "Subagent execution failed without an explicit error message.");
          }

          // Merge mappings
          this.mergeIdMappings(nextTask.sourceEntityType, subagentResult.newMappings);
          nextTask.status = 'completed';
          taskSuccess = true;
          
          const successMsg = `✅ **Aufgabe abgeschlossen:** ${nextTask.description}. ${Object.keys(subagentResult.newMappings).length} Objekte erfolgreich übertragen.`;
          await this.context.logActivity('success', `[Orchestrator] Task completed successfully: ${nextTask.description}`);
          await this.context.writeChatMessage('assistant', successMsg, params.stepNumber);

        } catch (error: any) {
          nextTask.retries++;
          nextTask.error = error.message;
          await this.context.logActivity('warning', `[Orchestrator] Task ${nextTask.id} failed (Retry ${nextTask.retries}/${MAX_RETRIES}): ${error.message}`);
          
          if (nextTask.retries >= MAX_RETRIES) {
              await this.context.writeChatMessage('assistant', `❌ **Aufgabe fehlgeschlagen:** ${nextTask.description}. Fehler: ${error.message}`, params.stepNumber);
          }
        }
      }

      if (!taskSuccess) {
         nextTask.status = 'failed';
         await this.saveState();
         const errorMsg = `Migration paused: Task ${nextTask.id} failed after maximum retries.`;
         await this.context.logActivity('error', errorMsg);
         throw new Error(errorMsg);
      }

      // 4. Save state after successful task
      await this.saveState(); 
    }

    if (this.hasPendingTasks()) {
      await this.context.logActivity('warning', '[Orchestrator] Migration paused or aborted due to agent limits.');
    } else {
      await this.context.logActivity('success', '[Orchestrator] All tasks in execution plan completed successfully!');
    }
  }

  private async loadOrInitializeState(params: any): Promise<OrchestratorState> {
    let plan = params.initialPlan;
    
    if (!plan || !plan.tasks || plan.tasks.length === 0) {
      await this.context.logActivity('warning', '[Orchestrator] No existing plan from Step 4 found. Proceeding with fallback sequence.');
      plan = { tasks: [] };
    }

    await this.context.logActivity('info', '[Orchestrator] Refining Step 4 plan into a concrete Insertion Plan...');

    const prompt = `
Du bist ein Data Transfer Orchestrator. 
Dir liegt ein grober Ausführungsplan aus Step 4 vor:
${JSON.stringify(plan, null, 2)}

Quell-Entitäten: ${JSON.stringify(params.sourceEntities)}
Ziel-Entitäten: ${JSON.stringify(params.targetEntities)}
Ziel-System Spezifikation (Export Instructions): ${JSON.stringify(params.targetSchema?.exportInstructions || {}, null, 2)}
Ziel-Container ID (bereits in Phase 0 erstellt): ${params.targetScopeId || "Keiner"}

Aufgabe:
Definiere basierend auf dem groben Plan die konkreten "Sub Goals" (Tasks) und die exakte Reihenfolge (dependsOn), in der die Objekte transferiert werden müssen.
Besonders wichtig: Analysiere, wann Parent-IDs gecached werden müssen und an den Agenten übergeben werden müssen, und füge diese Info zum Task hinzu (z.B. in der Description oder als neues Feld).

WICHTIG ZUM ZIEL-CONTAINER:
Falls der Plan vorsieht, ein Objekt zu erstellen, das bereits durch den Ziel-Container (ID: ${params.targetScopeId}) abgedeckt ist (z.B. Erstellen eines Spaces/Projekts, das bereits existiert), markiere diesen Task NICHT als fehlend, sondern plane ihn normal ein. Die Logik im Orchestrator wird diesen Task später automatisch als "bereits erledigt" behandeln, wenn die Mapping-IDs übergeben werden.

Antworte strikt im JSON Format für einen ExecutionPlan:
{
  "tasks": [
    {
      "id": "string",
      "description": "string (inklusive Info ob/welche Parent IDs gecached werden)",
      "sourceEntityType": "string",
      "targetEntityType": "string",
      "dependsOn": ["task_id_1"],
      "status": "pending",
      "retries": 0
    }
  ]
}
`;

    try {
        const refineRes = await this.provider.chat([{ role: "system", content: prompt }], undefined, {
            model: "gpt-4o",
            response_format: { type: "json_object" }
        });
        const refinedPlan = JSON.parse(refineRes.content || "{}");
        if (refinedPlan.tasks && Array.isArray(refinedPlan.tasks)) {
            plan = refinedPlan;
            await this.context.logActivity('success', `[Orchestrator] Generated concrete Insertion Plan with ${plan.tasks.length} tasks.`);
        }
    } catch (e) {
        await this.context.logActivity('error', '[Orchestrator] Failed to refine plan, using initial plan directly.');
    }

    const idMappings: Record<string, Record<string, string>> = {};

    // GENERIC FIX: If targetScopeId is present, pre-map the source scope to this ID
    if (params.targetScopeId && params.sourceScopeIds && params.sourceScopeIds.length > 0) {
        const sourceScopeId = params.sourceScopeIds[0];
        
        // Find the first task which usually corresponds to the root scope migration
        // or look for a task whose targetEntityType matches common container types.
        const containerTask = plan.tasks.find((t: any) => 
            t.dependsOn.length === 0 && 
            (t.targetEntityType.toLowerCase().includes('space') || 
             t.targetEntityType.toLowerCase().includes('project') || 
             t.targetEntityType.toLowerCase().includes('workspace') ||
             t.targetEntityType.toLowerCase().includes('folder'))
        );

        if (containerTask) {
            if (!idMappings[containerTask.sourceEntityType]) idMappings[containerTask.sourceEntityType] = {};
            idMappings[containerTask.sourceEntityType][sourceScopeId] = params.targetScopeId;
            
            // Mark the task as completed as it was already handled in Phase 0
            containerTask.status = 'completed';
            await this.context.logActivity('info', `[Orchestrator] Auto-completed task ${containerTask.id} because the target container was already created in Phase 0.`);
        }
    }

    return {
      migrationId: params.migrationId,
      plan,
      idMappings,
      globalContext: {},
      lastUpdated: new Date().toISOString(),
      totalAgentRuns: 0
    };
  }

  private hasPendingTasks(): boolean {
    return this.state.plan.tasks.some(t => t.status === 'pending' || t.status === 'in_progress');
  }

  private getNextReadyTask(): ExecutionTask | undefined {
    // Find tasks that are pending and whose dependencies are completed
    return this.state.plan.tasks.find(task => {
      if (task.status !== 'pending') return false;

      // Check if all dependencies are completed
      return task.dependsOn.every(depId => {
        const depTask = this.state.plan.tasks.find(t => t.id === depId);
        return depTask && depTask.status === 'completed';
      });
    });
  }

  private mergeIdMappings(entityType: string, newMappings: Record<string, string>) {
    if (!this.state.idMappings[entityType]) {
      this.state.idMappings[entityType] = {};
    }
    this.state.idMappings[entityType] = {
      ...this.state.idMappings[entityType],
      ...newMappings
    };
  }

  private async saveState(): Promise<void> {
    this.state.lastUpdated = new Date().toISOString();
    
    // In a full implementation, you'd store this in the database.
    // E.g.: await this.context.saveResult({ orchestratorState: this.state });
    // For now, we'll just log it.
    console.log(`[Orchestrator State Saved] Migration: ${this.state.migrationId}, Tasks Completed: ${this.state.plan.tasks.filter(t => t.status === 'completed').length}/${this.state.plan.tasks.length}`);
  }
}
