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
    targetEntities: any[]
  }): Promise<void> {
    await this.context.logActivity('info', `[Orchestrator] Starting orchestration for migration ${params.migrationId}`);

    // 1. Initialize or Load State
    this.state = await this.loadOrInitializeState(params);

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
        throw new Error(errorMsg);
      }

      await this.context.logActivity('info', `[Orchestrator] Starting task: ${nextTask.description} (${nextTask.id})`);
      nextTask.status = 'in_progress';
      await this.saveState(); // Persist progress

      let taskSuccess = false;
      const MAX_RETRIES = 3;

      while (!taskSuccess && nextTask.retries < MAX_RETRIES) {
        this.state.totalAgentRuns++;
        
        if (this.state.totalAgentRuns > this.MAX_AGENT_RUNS) {
           const errorMsg = 'Circuit Breaker triggered: Maximum agent runs exceeded.';
           await this.context.logActivity('error', errorMsg);
           throw new Error(errorMsg);
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
          
          await this.context.logActivity('success', `[Orchestrator] Task completed successfully: ${nextTask.description}`);

        } catch (error: any) {
          nextTask.retries++;
          nextTask.error = error.message;
          await this.context.logActivity('warning', `[Orchestrator] Task ${nextTask.id} failed (Retry ${nextTask.retries}/${MAX_RETRIES}): ${error.message}`);
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
    // In a real scenario, check DB or cache first via this.context
    // For now, always initialize fresh.
    let plan = params.initialPlan;
    
    if (!plan) {
      await this.context.logActivity('info', '[Orchestrator] Generating new Execution Plan...');
      const planner = new TransferPlannerAgent(this.provider, this.context);
      plan = await planner.execute({
        mappingRules: params.mappingRules,
        sourceSchema: params.sourceSchema,
        targetSchema: params.targetSchema,
        sourceEntities: params.sourceEntities,
        targetEntities: params.targetEntities
      });
      await this.context.logActivity('info', `[Orchestrator] Generated plan with ${plan.tasks.length} tasks.`);
    }

    return {
      migrationId: params.migrationId,
      plan,
      idMappings: {},
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
