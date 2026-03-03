import { Pool } from 'pg';
import { runIntroductionAgent, runAnswerAgent} from '../agents/agentService';
import { AGENT_WORKFLOW_STEPS } from '../constants/agentWorkflow';
import { StepFactory } from '../agents/core/StepFactory';
import { 
  saveStep1Result, 
  saveStep2Result, 
  saveStep3Result, 
  saveStep4Result, 
  saveStep5Result, 
  saveStep6Result, 
  saveStep7Result 
} from '../lib/step-results';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const POLL_INTERVAL = 5000; // 5 seconds

async function logActivity(migrationId: string, type: 'success' | 'error' | 'info' | 'warning', title: string) {
  const timestamp = new Date().toISOString();
  await pool.query('INSERT INTO migration_activities (migration_id, type, title, timestamp) VALUES ($1, $2, $3, $4)', [
    migrationId,
    type,
    title,
    timestamp,
  ]);
}

// Hilfsfunktion zum Schreiben von Chat-Nachrichten (Verwendet eigene Connection für Sofort-Commit)
async function writeChatMessage(migrationId: string, role: string, content: string, stepNumber?: number) {
  const res = await pool.query(
    'INSERT INTO migration_chat_messages (migration_id, role, content, step_number) VALUES ($1, $2, $3, $4) RETURNING id',
    [migrationId, role, content, stepNumber]
  );
  return res.rows[0]?.id;
}

async function upsertChatMessage(id: string | null, migrationId: string, role: string, content: string, stepNumber?: number) {
  if (id) {
    await pool.query(
      'UPDATE migration_chat_messages SET content = $1, created_at = now() WHERE id = $2',
      [content, id]
    );
    return id;
  } else {
    return await writeChatMessage(migrationId, role, content, stepNumber);
  }
}

async function writeRetryAction(migrationId: string, stepNumber: number) {
  const actionContent = JSON.stringify({
    type: "action",
    actions: [
      {
        action: "retry",
        label: `Schritt ${stepNumber} wiederholen`,
        variant: "outline",
        stepNumber: stepNumber
      }
    ]
  });
  await writeChatMessage(migrationId, 'system', actionContent, stepNumber);
}

// Result Persistence Helpers moved to ../lib/step-results.ts

const ensureWorkflowState = (state: any = {}) => {
  const safeState = state || {};
  const nodes = Array.isArray(safeState.nodes) ? [...safeState.nodes] : [];
  const connections = Array.isArray(safeState.connections) ? [...safeState.connections] : [];
  return { nodes, connections };
};

const incrementGlobalStats = async (client: any, data: { steps?: number, success?: number, total_agents?: number }) => {
  const { steps = 0, success = 0, total_agents = 0 } = data;
  try {
    await client.query(`
      INSERT INTO public.global_stats 
      (day, steps_completed, agent_success_count, agent_total_count)
      VALUES (CURRENT_DATE, $1, $2, $3)
      ON CONFLICT (day) DO UPDATE SET
          steps_completed = global_stats.steps_completed + EXCLUDED.steps_completed,
          agent_success_count = global_stats.agent_success_count + EXCLUDED.agent_success_count,
          agent_total_count = global_stats.agent_total_count + EXCLUDED.agent_total_count
    `, [steps, success, total_agents]);
  } catch (e) {
    console.error('[Worker] Failed to update global stats:', e);
  }
};

const updateWorkflowForStep = (state: any, workflowStepId: string, result: any, isError: boolean) => {
  const nextState = ensureWorkflowState(state);
  const nodes = nextState.nodes.map((node: any) => ({ ...node }));

  let targetNode = nodes.find((node: any) => node.id === workflowStepId);
  if (!targetNode) {
    targetNode = {
      id: workflowStepId,
      title: workflowStepId,
      status: 'pending',
      agentResult: undefined,
    };
    nodes.push(targetNode);
  }

  targetNode.status = 'done';
  targetNode.agentResult = isError ? { error: String(result) } : result;

  nextState.nodes = nodes;
  const completedCount = nodes.filter((n: any) => n.status === 'done').length;
  const totalSteps = 10; // We always have 10 steps in the workflow
  const progress = Math.round((completedCount / totalSteps) * 100);

  return { nextState, progress, completedCount, totalSteps };
};

async function processJob(job: any) {
  let { step_id, payload } = job;
  
  // Defensive parsing of payload
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      console.error(`[Worker] Failed to parse payload for job ${job.id}:`, e);
    }
  }

  const agentName = payload?.agentName;
  const agentParams = payload?.agentParams;

  console.log(`[Worker] Processing job ${job.id}. agentName: "${agentName}", step_id: ${step_id}, migrationId: ${payload?.migrationId}`);

  // 1. Step Record laden (Read-only)
  let migrationId = payload?.migrationId;
  let stepRecord: any = null;

  if (step_id) {
    const { rows: stepRows } = await pool.query(
      'SELECT id, migration_id, workflow_step_id, name FROM migration_steps WHERE id = $1', 
      [step_id]
    );
    stepRecord = stepRows[0];
    if (stepRecord) {
      migrationId = stepRecord.migration_id;
    }
  }

  const conversationalAgents = ['runAnswerAgent', 'runMappingRules', 'runEnhancementRules', 'runIntroductionAgent'];

  if (!stepRecord && !conversationalAgents.includes(agentName)) {
    console.error(`[Worker] [CRITICAL] Job ${job.id} failed: No stepRecord and agent "${agentName}" is not in conversationalAgents list [${conversationalAgents.join(', ')}]`);
    await pool.query('UPDATE jobs SET status = $1, last_error = $2 WHERE id = $3', ['failed', `Step not found for agent ${agentName}`, job.id]);
    return;
  }

  const currentStepNumber = payload.stepNumber || 1;
  const activeStep = AGENT_WORKFLOW_STEPS[currentStepNumber - 1];
  const stepTitle = activeStep?.title || stepRecord?.name || 'Schritt';

  // 2. Start-Status setzen (Transaction 1 - Sofort committen)
  const startClient = await pool.connect();
  try {
    await startClient.query('BEGIN');
    if (step_id) {
      await startClient.query('UPDATE migration_steps SET status = $1 WHERE id = $2', ['running', step_id]);
    }
    // Update migration status only for process-relevant agents (not for Consultant, MappingRules or Introduction)
    if (!conversationalAgents.includes(agentName)) {
      await startClient.query('UPDATE migrations SET status = $1, step_status = $2 WHERE id = $3', ['processing', 'running', migrationId]);
    }
    await startClient.query('COMMIT');
  } catch (e) {
    await startClient.query('ROLLBACK');
    throw e;
  } finally {
    startClient.release();
  }

  // Start-Nachricht im Chat (Sofort sichtbar)
  // MODIFIED: Only show for non-split agents or the first part of split agents (source)
  // Skip for Conversational Agents
  if (!conversationalAgents.includes(agentName) && (agentParams?.mode || 'source') === 'source') {
    await writeChatMessage(migrationId, 'assistant', `Starte Schritt ${currentStepNumber} ${stepTitle}...`, currentStepNumber);
  }

  console.log("Agent params:", JSON.stringify(agentParams, null, 2));

  try {
    let result: any;
    let resultMessageText = "Step completed.";
    let isLogicalFailure = false;
    let failureMessage = "";

    if (agentName === 'runSystemDetection') {
      const mode = agentParams?.mode || 'source';
      const context = {
        migrationId,
        stepNumber: currentStepNumber,
        writeChatMessage: async (role, content, stepNum) => await writeChatMessage(migrationId, role, content, stepNum),
        logActivity: async (type, title) => await logActivity(migrationId, type, title),
        getConnector: async (type) => {
            const { rows } = await pool.query('SELECT api_url, api_key, username FROM connectors WHERE migration_id = $1 AND connector_type = $2', [migrationId, type]);
            return rows[0];
        },
        getMigrationDetails: async () => {
            const { rows } = await pool.query('SELECT scope_config FROM migrations WHERE id = $1', [migrationId]);
            return rows[0];
        }
      };

      const agent = await StepFactory.createAgent(agentName, context);
      if (agent) {
        try {
          const agentResult = await agent.execute(agentParams);
          isLogicalFailure = !!agentResult.isLogicalFailure;
          failureMessage = agentResult.error || "";
          result = agentResult.result || agentResult;
          resultMessageText = JSON.stringify(result);
        } catch (err) {
          isLogicalFailure = true;
          failureMessage = String(err);
          result = { error: failureMessage, system_mode: mode };
          resultMessageText = failureMessage;
        }
      } else {
        isLogicalFailure = true;
        failureMessage = "Agent not found in StepFactory";
        result = { error: failureMessage, system_mode: mode };
        resultMessageText = failureMessage;
      }

      await writeChatMessage(migrationId, 'assistant', resultMessageText, currentStepNumber);
      if (!isLogicalFailure) {
        await saveStep1Result(pool, migrationId, mode, result);
      }

      const finishClient = await pool.connect();
      try {
        await finishClient.query('BEGIN');
        const { rows: otherJobs } = await finishClient.query(
          "SELECT id FROM jobs WHERE step_id = $1 AND id != $2 AND status IN ('pending', 'running')",
          [step_id, job.id]
        );
        const isLastJob = otherJobs.length === 0;
        const { rows: currentStepRows } = await finishClient.query('SELECT result, status FROM migration_steps WHERE id = $1', [step_id]);
        const existingResult = currentStepRows[0]?.result || {};
        const stepHadFailure = currentStepRows[0]?.status === 'failed';
        
        const combinedStepResult = { ...existingResult, [mode]: result };
        const finalStepStatus = (isLogicalFailure || stepHadFailure) ? 'failed' : (isLastJob ? 'completed' : 'running');

        await finishClient.query('UPDATE migration_steps SET status = $1, result = $2, status_message = $3 WHERE id = $4', [
          finalStepStatus,
          combinedStepResult,
          isLogicalFailure ? failureMessage : (isLastJob ? 'All detections completed successfully.' : `Detection for ${mode} completed.`),
          step_id,
        ]);

        const { rows: migrationRows } = await finishClient.query('SELECT workflow_state FROM migrations WHERE id = $1', [migrationId]);
        const migrationData = migrationRows[0];
        const { nextState, progress, totalSteps, completedCount } = updateWorkflowForStep(
          migrationData?.workflow_state,
          stepRecord.workflow_step_id || step_id,
          combinedStepResult,
          (isLogicalFailure || stepHadFailure)
        );

        const migrationStatus = (isLogicalFailure || stepHadFailure) ? 'paused' : (isLastJob && completedCount >= totalSteps ? 'completed' : 'processing');
        const stepStatusForMigration = (isLogicalFailure || stepHadFailure) ? 'failed' : (isLastJob ? 'completed' : 'running');

        await finishClient.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4, current_step = $5 WHERE id = $6', [
          nextState,
          progress,
          migrationStatus,
          stepStatusForMigration,        
          currentStepNumber,  
          migrationId,
        ]);

        await finishClient.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
        
        if (finalStepStatus === 'completed') {
          await incrementGlobalStats(finishClient, { steps: 1, success: 1, total_agents: 1 });
        } else if (finalStepStatus === 'failed') {
          await incrementGlobalStats(finishClient, { total_agents: 1 });
        }

        await finishClient.query('COMMIT');

        if (isLogicalFailure) {
          await writeChatMessage(migrationId, 'assistant', `Schritt 1 System Detection fehlgeschlagen (**${mode === 'source' ? 'Quellsystem' : 'Zielsystem'}** passt nicht).`, currentStepNumber);
          await writeRetryAction(migrationId, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt ${mode}-Erkennung fehlgeschlagen.`);
        } else {
          await writeChatMessage(migrationId, 'assistant', `**${mode === 'source' ? 'Quellsystem' : 'Zielsystem'}**-Analyse erfolgreich.`, currentStepNumber);
          if (isLastJob) {
             await writeChatMessage(migrationId, 'assistant', `Schritt 1 **System Detection** erfolgreich.`, currentStepNumber);
             const nextStepIndex = currentStepNumber;
             if (nextStepIndex < AGENT_WORKFLOW_STEPS.length) {
                 const nextStep = AGENT_WORKFLOW_STEPS[nextStepIndex];
                 const actionContent = JSON.stringify({
                     type: "action",
                     actions: [
                       { action: "continue", label: `Weiter zu Schritt ${nextStepIndex + 1} ${nextStep.title}`, variant: "primary" },
                       { action: "retry", label: `Schritt ${currentStepNumber} wiederholen`, variant: "outline", stepNumber: currentStepNumber }
                     ]
                 });
                 await writeChatMessage(migrationId, 'system', actionContent, currentStepNumber);
             }
          }
          await logActivity(migrationId, 'success', `Schritt ${mode}-Erkennung abgeschlossen.`);
        }
      } catch (e) {
        await finishClient.query('ROLLBACK');
        throw e;
      } finally {
        finishClient.release();
      }

    } else if (agentName === 'runCapabilityDiscovery') {
      const context = {
        migrationId,
        stepNumber: currentStepNumber,
        writeChatMessage: async (role, content, stepNum) => await writeChatMessage(migrationId, role, content, stepNum),
        logActivity: async (type, title) => await logActivity(migrationId, type, title),
        getConnector: async (type) => {
            const { rows } = await pool.query('SELECT api_url, api_key, username FROM connectors WHERE migration_id = $1 AND connector_type = $2', [migrationId, type]);
            return rows[0];
        },
        getMigrationDetails: async () => {
            const { rows } = await pool.query('SELECT scope_config FROM migrations WHERE id = $1', [migrationId]);
            return rows[0];
        }
      };

      const agent = await StepFactory.createAgent(agentName, context);
      if (agent) {
        try {
          const agentResult = await agent.execute(agentParams);
          isLogicalFailure = !!agentResult.isLogicalFailure;
          failureMessage = agentResult.error || "";
          result = agentResult.result || agentResult;
          resultMessageText = JSON.stringify(result);
        } catch (err) {
          isLogicalFailure = true;
          failureMessage = String(err);
          result = { error: failureMessage };
          resultMessageText = failureMessage;
        }
      } else {
        isLogicalFailure = true;
        failureMessage = "Agent not found in StepFactory";
        result = { error: failureMessage };
        resultMessageText = failureMessage;
      }

      if (resultMessageText) {
          await writeChatMessage(migrationId, 'assistant', resultMessageText, currentStepNumber);
      }
      if (!isLogicalFailure) {
        await saveStep3Result(pool, migrationId, result);
      }

      const finishClient = await pool.connect();
      try {
        await finishClient.query('BEGIN');
        const { rows: currentStepRows } = await finishClient.query('SELECT result, status FROM migration_steps WHERE id = $1', [step_id]);
        const existingResult = currentStepRows[0]?.result || {};
        const combinedStepResult = { ...existingResult, discovery: result };
        const finalStepStatus = isLogicalFailure ? 'failed' : 'completed';

        await finishClient.query('UPDATE migration_steps SET status = $1, result = $2, status_message = $3 WHERE id = $4', [
          finalStepStatus, combinedStepResult, isLogicalFailure ? failureMessage : 'Source discovery completed successfully.', step_id,
        ]);

        const { rows: migrationRows } = await finishClient.query('SELECT workflow_state FROM migrations WHERE id = $1', [migrationId]);
        const migrationData = migrationRows[0];
        const { nextState, progress, totalSteps, completedCount } = updateWorkflowForStep(migrationData?.workflow_state, stepRecord.workflow_step_id || step_id, combinedStepResult, isLogicalFailure);
        const migrationStatus = isLogicalFailure ? 'paused' : (completedCount >= totalSteps ? 'completed' : 'processing');
        const stepStatusForMigration = isLogicalFailure ? 'failed' : 'completed';

        await finishClient.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4, current_step = $5 WHERE id = $6', [
          nextState, progress, migrationStatus, stepStatusForMigration, currentStepNumber, migrationId,
        ]);
        await finishClient.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
        
        if (finalStepStatus === 'completed') {
          await incrementGlobalStats(finishClient, { steps: 1, success: 1, total_agents: 1 });
        } else if (finalStepStatus === 'failed') {
          await incrementGlobalStats(finishClient, { total_agents: 1 });
        }

        await finishClient.query('COMMIT');

        if (isLogicalFailure) {
          await writeChatMessage(migrationId, 'assistant', `Schritt 3 Source Discovery fehlgeschlagen.`, currentStepNumber);
          await writeRetryAction(migrationId, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt Source Discovery fehlgeschlagen.`);
        } else {
          await writeChatMessage(migrationId, 'assistant', `Schritt 3 **Source Discovery** erfolgreich abgeschlossen.`, currentStepNumber);
          const nextStepIndex = currentStepNumber;
          if (nextStepIndex < AGENT_WORKFLOW_STEPS.length) {
              const nextStep = AGENT_WORKFLOW_STEPS[nextStepIndex];
              const actionContent = JSON.stringify({
                  type: "action",
                  actions: [
                    { action: "continue", label: `Weiter zu Schritt ${nextStepIndex + 1} ${nextStep.title}`, variant: "primary" },
                    { action: "retry", label: `Schritt ${currentStepNumber} wiederholen`, variant: "outline", stepNumber: currentStepNumber }
                  ]
              });
              await writeChatMessage(migrationId, 'system', actionContent, currentStepNumber);
          }
          await logActivity(migrationId, 'success', `Schritt Source Discovery abgeschlossen.`);
        }
      } catch (e) {
        await finishClient.query('ROLLBACK');
        throw e;
      } finally {
        finishClient.release();
      }

    } else if (agentName === 'runTargetSchema') {
      const context = {
        migrationId,
        stepNumber: currentStepNumber,
        writeChatMessage: async (role, content, stepNum) => await writeChatMessage(migrationId, role, content, stepNum),
        logActivity: async (type, title) => await logActivity(migrationId, type, title),
        getConnector: async (type) => {
            const { rows } = await pool.query('SELECT api_url, api_key, username FROM connectors WHERE migration_id = $1 AND connector_type = $2', [migrationId, type]);
            return rows[0];
        },
        getMigrationDetails: async () => {
            const { rows } = await pool.query('SELECT name, scope_config FROM migrations WHERE id = $1', [migrationId]);
            return rows[0];
        }
      };

      const agent = await StepFactory.createAgent(agentName, context);
      if (agent) {
        try {
          const agentResult = await agent.execute(agentParams);
          isLogicalFailure = !!agentResult.isLogicalFailure;
          failureMessage = agentResult.error || "";
          result = agentResult.result || agentResult;
          resultMessageText = JSON.stringify(result);
        } catch (err) {
          isLogicalFailure = true;
          failureMessage = String(err);
          result = { error: failureMessage };
          resultMessageText = failureMessage;
        }
      } else {
        isLogicalFailure = true;
        failureMessage = "Agent not found in StepFactory";
        result = { error: failureMessage };
        resultMessageText = failureMessage;
      }

      await writeChatMessage(migrationId, 'assistant', resultMessageText, currentStepNumber);
      if (!isLogicalFailure) {
        await saveStep4Result(pool, migrationId, result);
      }

      const finishClient = await pool.connect();
      try {
        await finishClient.query('BEGIN');
        const { rows: currentStepRows } = await finishClient.query('SELECT result, status FROM migration_steps WHERE id = $1', [step_id]);
        const existingResult = currentStepRows[0]?.result || {};
        const combinedStepResult = { ...existingResult, targetDiscovery: result };
        const finalStepStatus = isLogicalFailure ? 'failed' : 'completed';

        await finishClient.query('UPDATE migration_steps SET status = $1, result = $2, status_message = $3 WHERE id = $4', [
          finalStepStatus, combinedStepResult, isLogicalFailure ? failureMessage : 'Target discovery completed successfully.', step_id,
        ]);

        const { rows: migrationRows } = await finishClient.query('SELECT workflow_state FROM migrations WHERE id = $1', [migrationId]);
        const migrationData = migrationRows[0];
        const { nextState, progress, totalSteps, completedCount } = updateWorkflowForStep(migrationData?.workflow_state, stepRecord.workflow_step_id || step_id, combinedStepResult, isLogicalFailure);
        const migrationStatus = isLogicalFailure ? 'paused' : (completedCount >= totalSteps ? 'completed' : 'processing');
        const stepStatusForMigration = isLogicalFailure ? 'failed' : 'completed';

        await finishClient.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4, current_step = $5 WHERE id = $6', [
          nextState, progress, migrationStatus, stepStatusForMigration, currentStepNumber, migrationId,
        ]);
        await finishClient.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
        
        if (finalStepStatus === 'completed') {
          await incrementGlobalStats(finishClient, { steps: 1, success: 1, total_agents: 1 });
        } else if (finalStepStatus === 'failed') {
          await incrementGlobalStats(finishClient, { total_agents: 1 });
        }

        await finishClient.query('COMMIT');

        if (isLogicalFailure) {
          await writeChatMessage(migrationId, 'assistant', `Schritt 4 Target Discovery fehlgeschlagen.`, currentStepNumber);
          await writeRetryAction(migrationId, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt Target Discovery fehlgeschlagen.`);
        } else {
          await writeChatMessage(migrationId, 'assistant', `Schritt 4 **Target Discovery** erfolgreich abgeschlossen.`, currentStepNumber);
          const nextStepIndex = currentStepNumber;
          if (nextStepIndex < AGENT_WORKFLOW_STEPS.length) {
              const nextStep = AGENT_WORKFLOW_STEPS[nextStepIndex];
              const actionContent = JSON.stringify({
                  type: "action",
                  actions: [
                    { action: "continue", label: `Weiter zu Schritt ${nextStepIndex + 1} ${nextStep.title}`, variant: "primary" },
                    { action: "retry", label: `Schritt ${currentStepNumber} wiederholen`, variant: "outline", stepNumber: currentStepNumber }
                  ]
              });
              await writeChatMessage(migrationId, 'system', actionContent, currentStepNumber);
          }
          await logActivity(migrationId, 'success', `Schritt Target Discovery abgeschlossen.`);
        }
      } catch (e) {
        await finishClient.query('ROLLBACK');
        throw e;
      } finally {
        finishClient.release();
      }

    } else if (agentName === 'runAuthFlow') {
      const mode = agentParams?.mode || 'source';
      const context = {
        migrationId,
        stepNumber: currentStepNumber,
        writeChatMessage: async (role, content, stepNum) => await writeChatMessage(migrationId, role, content, stepNum),
        logActivity: async (type, title) => await logActivity(migrationId, type, title),
        getConnector: async (type) => {
            const { rows } = await pool.query('SELECT api_url, api_key, username FROM connectors WHERE migration_id = $1 AND connector_type = $2', [migrationId, type]);
            return rows[0];
        },
        getMigrationDetails: async () => {
            const { rows } = await pool.query('SELECT scope_config FROM migrations WHERE id = $1', [migrationId]);
            return rows[0];
        }
      };

      const agent = await StepFactory.createAgent(agentName, context);
      if (agent) {
        try {
          const agentResult = await agent.execute(agentParams);
          isLogicalFailure = !!agentResult.isLogicalFailure;
          failureMessage = agentResult.error || "";
          result = agentResult.result || agentResult;
          resultMessageText = JSON.stringify(result);
        } catch (err) {
          isLogicalFailure = true;
          failureMessage = String(err);
          result = { error: failureMessage, system_mode: mode };
          resultMessageText = failureMessage;
        }
      } else {
        isLogicalFailure = true;
        failureMessage = "Agent not found in StepFactory";
        result = { error: failureMessage, system_mode: mode };
        resultMessageText = failureMessage;
      }

      await writeChatMessage(migrationId, 'assistant', resultMessageText, currentStepNumber);
      if (!isLogicalFailure) {
        await saveStep2Result(pool, migrationId, mode, result);
      }

      const finishClient = await pool.connect();
      try {
        await finishClient.query('BEGIN');
        const { rows: otherJobs } = await finishClient.query("SELECT id FROM jobs WHERE step_id = $1 AND id != $2 AND status IN ('pending', 'running')", [step_id, job.id]);
        const isLastJob = otherJobs.length === 0;
        const { rows: currentStepRows } = await finishClient.query('SELECT result, status FROM migration_steps WHERE id = $1', [step_id]);
        const existingResult = currentStepRows[0]?.result || {};
        const stepHadFailure = currentStepRows[0]?.status === 'failed';
        const combinedStepResult = { ...existingResult, [mode]: result };
        const finalStepStatus = (isLogicalFailure || stepHadFailure) ? 'failed' : (isLastJob ? 'completed' : 'running');

        await finishClient.query('UPDATE migration_steps SET status = $1, result = $2, status_message = $3 WHERE id = $4', [
          finalStepStatus, combinedStepResult, isLogicalFailure ? failureMessage : (isLastJob ? 'Authentication successful for all systems.' : `Authentication for ${mode} completed.`), step_id,
        ]);

        const { rows: migrationRows } = await finishClient.query('SELECT workflow_state FROM migrations WHERE id = $1', [migrationId]);
        const migrationData = migrationRows[0];
        const { nextState, progress, totalSteps, completedCount } = updateWorkflowForStep(migrationData?.workflow_state, stepRecord.workflow_step_id || step_id, combinedStepResult, (isLogicalFailure || stepHadFailure));
        const migrationStatus = (isLogicalFailure || stepHadFailure) ? 'paused' : (isLastJob && completedCount >= totalSteps ? 'completed' : 'processing');
        const stepStatusForMigration = (isLogicalFailure || stepHadFailure) ? 'failed' : (isLastJob ? 'completed' : 'running');

        await finishClient.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4, current_step = $5 WHERE id = $6', [
          nextState, progress, migrationStatus, stepStatusForMigration, currentStepNumber, migrationId,
        ]);
        await finishClient.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
        
        if (finalStepStatus === 'completed') {
          await incrementGlobalStats(finishClient, { steps: 1, success: 1, total_agents: 1 });
        } else if (finalStepStatus === 'failed') {
          await incrementGlobalStats(finishClient, { total_agents: 1 });
        }

        await finishClient.query('COMMIT');

        if (isLogicalFailure) {
          await writeChatMessage(migrationId, 'assistant', `Schritt 2 Authentication fehlgeschlagen (**${mode === 'source' ? 'Quellsystem' : 'Zielsystem'}** konnte nicht authentifiziert werden).`, currentStepNumber);
          await writeRetryAction(migrationId, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt ${mode}-Authentifizierung fehlgeschlagen.`);
        } else {
          await writeChatMessage(migrationId, 'assistant', `**${mode === 'source' ? 'Quellsystem' : 'Zielsystem'}** erfolgreich authentifiziert.`, currentStepNumber);
          if (isLastJob) {
             await writeChatMessage(migrationId, 'assistant', `Schritt 2 **Authentication** erfolgreich.`, currentStepNumber);
             const nextStepIndex = currentStepNumber;
             if (nextStepIndex < AGENT_WORKFLOW_STEPS.length) {
                 const nextStep = AGENT_WORKFLOW_STEPS[nextStepIndex];
                 const actionContent = JSON.stringify({
                     type: "action",
                     actions: [
                       { action: "continue", label: `Weiter zu Schritt ${nextStepIndex + 1} ${nextStep.title}`, variant: "primary" },
                       { action: "retry", label: `Schritt ${currentStepNumber} wiederholen`, variant: "outline", stepNumber: currentStepNumber }
                     ]
                 });
                 await writeChatMessage(migrationId, 'system', actionContent, currentStepNumber);
             }
          }
          await logActivity(migrationId, 'success', `Schritt ${mode}-Authentifizierung abgeschlossen.`);
        }
      } catch (e) {
        await finishClient.query('ROLLBACK');
        throw e;
      } finally {
        finishClient.release();
      }

    } else if (agentName === 'runAnswerAgent') {
      const userMessage = agentParams?.userMessage;
      const context = agentParams?.context;
      
      // Set status to thinking
      await pool.query('UPDATE migrations SET consultant_status = $1 WHERE id = $2', ['thinking', migrationId]);
      
      const { rows: migrationRows } = await pool.query('SELECT source_system FROM migrations WHERE id = $1', [migrationId]);
      const sourceSystem = migrationRows[0]?.source_system;

      const messageGenerator = runAnswerAgent(userMessage, {
          ...context,
          migrationId,
          sourceSystem
      });
      let assistantResponse = "";
      for await (const message of messageGenerator) {
        if (message.content && message.content.length > 0 && message.content[0].text) {
          assistantResponse = message.content[0].text;
        }
      }
      if (assistantResponse) {
        await writeChatMessage(migrationId, 'assistant', assistantResponse);
      }
      
      // Reset status to idle
      await pool.query('UPDATE migrations SET consultant_status = $1 WHERE id = $2', ['idle', migrationId]);

      await pool.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
      return;

    } else if (agentName === 'runIntroductionAgent') {
      const userMessage = agentParams?.userMessage;
      const context = agentParams?.context;
      
      // Set status to thinking
      await pool.query('UPDATE migrations SET consultant_status = $1 WHERE id = $2', ['thinking', migrationId]);
      
      // Fetch current migration name
      const { rows: migRows } = await pool.query('SELECT name FROM migrations WHERE id = $1', [migrationId]);
      const migrationName = migRows[0]?.name;

      const messageGenerator = runIntroductionAgent(userMessage, {
          ...context,
          migrationId,
          migrationName
      });
      
      for await (const message of messageGenerator) {
        if (message.content && message.content.length > 0 && message.content[0].text) {
          const text = message.content[0].text;
          if (text.startsWith("AUSGABE_TOOL_CALL:FINISH_ONBOARDING:")) {
              const argsStr = text.replace("AUSGABE_TOOL_CALL:FINISH_ONBOARDING:", "");
              const args = JSON.parse(argsStr);
              
              // 1. Update Migration
              await pool.query(
                `UPDATE migrations SET 
                  name = $1, 
                  source_system = $2, 
                  source_url = $3, 
                  target_system = $4, 
                  target_url = $5,
                  current_step = 0,
                  status = 'not_started',
                  step_status = 'idle',
                  scope_config = $6
                WHERE id = $7`,
                [
                  args.name, 
                  args.source.system, 
                  args.source.url, 
                  args.target.system, 
                  args.target.url,
                  JSON.stringify({
                    sourceScope: args.source.scope,
                    targetName: args.target.scope,
                    targetContainerType: args.target.containerType
                  }),
                  migrationId
                ]
              );

              // 2. Update Connectors
              // Source
              await pool.query(
                `INSERT INTO connectors (migration_id, connector_type, api_url, api_key, username, auth_type)
                 VALUES ($1, 'in', $2, $3, $4, 'api_key')
                 ON CONFLICT (migration_id, connector_type) DO UPDATE SET
                   api_url = EXCLUDED.api_url,
                   api_key = EXCLUDED.api_key,
                   username = EXCLUDED.username`,
                [migrationId, args.source.url, args.source.apiToken, args.source.email]
              );
              // Target
              await pool.query(
                `INSERT INTO connectors (migration_id, connector_type, api_url, api_key, username, auth_type)
                 VALUES ($1, 'out', $2, $3, $4, 'api_key')
                 ON CONFLICT (migration_id, connector_type) DO UPDATE SET
                   api_url = EXCLUDED.api_url,
                   api_key = EXCLUDED.api_key,
                   username = EXCLUDED.username`,
                [migrationId, args.target.url, args.target.apiToken, args.target.email]
              );

              await writeChatMessage(migrationId, 'assistant', "Perfekt! Ich habe alles konfiguriert. Wir können jetzt mit der System-Erkennung (Schritt 1) starten.", 0);
          } else {
              await writeChatMessage(migrationId, 'assistant', text, 0);
          }
        }
      }
      
      // Reset status to idle
      await pool.query('UPDATE migrations SET consultant_status = $1 WHERE id = $2', ['idle', migrationId]);
      await pool.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
      return;

    } else if (agentName === 'runDataStaging') {
      const context = {
        migrationId,
        stepNumber: currentStepNumber,
        writeChatMessage: async (role, content, stepNum) => await writeChatMessage(migrationId, role, content, stepNum),
        logActivity: async (type, title) => await logActivity(migrationId, type, title),
        getConnector: async (type) => {
            const { rows } = await pool.query('SELECT api_url, api_key, username, auth_type FROM connectors WHERE migration_id = $1 AND connector_type = $2', [migrationId, type]);
            return rows[0];
        },
        getMigrationDetails: async () => {
            const { rows } = await pool.query('SELECT source_system, notes, scope_config FROM migrations WHERE id = $1', [migrationId]);
            return rows[0];
        },
        dbPool: pool
      };

      const agent = await StepFactory.createAgent(agentName, context);
      let totalImported = 0;
      if (agent) {
        try {
          const agentResult = await agent.execute(agentParams);
          isLogicalFailure = !!agentResult.isLogicalFailure;
          failureMessage = agentResult.error || "";
          result = agentResult.result || agentResult;
          totalImported = agentResult.totalImported || 0;
          resultMessageText = JSON.stringify(result);
        } catch (err) {
          isLogicalFailure = true;
          failureMessage = String(err);
          result = { error: failureMessage };
          resultMessageText = failureMessage;
        }
      } else {
        isLogicalFailure = true;
        failureMessage = "Agent not found in StepFactory";
        result = { error: failureMessage };
        resultMessageText = failureMessage;
      }

      await writeChatMessage(migrationId, 'assistant', resultMessageText, currentStepNumber);
      if (!isLogicalFailure) {
        await saveStep5Result(pool, migrationId, result);
      }

      const finishClientStaging = await pool.connect();
      try {
        await finishClientStaging.query('BEGIN');
        // If we have data, we mark it as completed to allow continuation, even if isLogicalFailure was true due to warnings
        const finalStepStatus = totalImported > 0 ? 'completed' : 'failed';
        
        await finishClientStaging.query('UPDATE migration_steps SET status = $1, result = $2, status_message = $3 WHERE id = $4', [
          finalStepStatus, result, isLogicalFailure ? failureMessage : 'Data staging completed.', step_id,
        ]);

        const { rows: migRowsStaging } = await finishClientStaging.query('SELECT workflow_state FROM migrations WHERE id = $1', [migrationId]);
        const migrationDataStaging = migRowsStaging[0];
        const { nextState, progress, totalSteps, completedCount } = updateWorkflowForStep(migrationDataStaging?.workflow_state, stepRecord.workflow_step_id || step_id, result, (totalImported === 0));
        const migrationStatus = (totalImported === 0) ? 'paused' : (completedCount >= totalSteps ? 'completed' : 'processing');
        const stepStatusForMigration = (totalImported === 0) ? 'failed' : 'completed';

        await finishClientStaging.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4, current_step = $5 WHERE id = $6', [
          nextState, progress, migrationStatus, stepStatusForMigration, currentStepNumber, migrationId,
        ]);
        await finishClientStaging.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
        
        if (finalStepStatus === 'completed') {
          await incrementGlobalStats(finishClientStaging, { steps: 1, success: 1, total_agents: 1 });
        } else if (finalStepStatus === 'failed') {
          await incrementGlobalStats(finishClientStaging, { total_agents: 1 });
        }

        await finishClientStaging.query('COMMIT');

        if (totalImported === 0) {
          await writeChatMessage(migrationId, 'assistant', `Schritt 5 Data Staging fehlgeschlagen.`, currentStepNumber);
          await writeRetryAction(migrationId, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt Data Staging fehlgeschlagen.`);
        } else {
          await writeChatMessage(migrationId, 'assistant', `Schritt 5 **Data Staging** erfolgreich abgeschlossen (${totalImported} Objekte geladen).`, currentStepNumber);
          const nextStepIndex = currentStepNumber;
          if (nextStepIndex < AGENT_WORKFLOW_STEPS.length) {
              const nextStep = AGENT_WORKFLOW_STEPS[nextStepIndex];
              const actionContent = JSON.stringify({
                  type: "action",
                  actions: [
                    { action: "continue", label: `Weiter zu Schritt ${nextStepIndex + 1} ${nextStep.title}`, variant: "primary" },
                    { action: "retry", label: `Schritt ${currentStepNumber} wiederholen`, variant: "outline", stepNumber: currentStepNumber }
                  ]
              });
              await writeChatMessage(migrationId, 'system', actionContent, currentStepNumber);
          }
          await logActivity(migrationId, 'success', `Schritt Data Staging abgeschlossen.`);
        }
      } catch (e) {
        await finishClientStaging.query('ROLLBACK');
        throw e;
      } finally {
        finishClientStaging.release();
      }

    } else if (agentName === 'runMappingVerification') {
      const context = {
        migrationId,
        stepNumber: currentStepNumber,
        writeChatMessage: async (role, content, stepNum) => await writeChatMessage(migrationId, role, content, stepNum),
        logActivity: async (type, title) => await logActivity(migrationId, type, title),
        getConnector: async (type) => {
            const { rows } = await pool.query('SELECT api_url, api_key, username FROM connectors WHERE migration_id = $1 AND connector_type = $2', [migrationId, type]);
            return rows[0];
        },
        getMigrationDetails: async () => {
            const { rows } = await pool.query('SELECT source_system, target_system FROM migrations WHERE id = $1', [migrationId]);
            return rows[0];
        },
        dbPool: pool
      };

      const agent = await StepFactory.createAgent(agentName, context);
      if (agent) {
        try {
          const agentResult = await agent.execute(agentParams);
          isLogicalFailure = !!agentResult.isLogicalFailure;
          failureMessage = agentResult.error || "";
          result = agentResult.result || agentResult;
          resultMessageText = JSON.stringify(result);
        } catch (err) {
          isLogicalFailure = true;
          failureMessage = String(err);
          result = { error: failureMessage };
          resultMessageText = failureMessage;
        }
      } else {
        isLogicalFailure = true;
        failureMessage = "Agent not found in StepFactory";
        result = { error: failureMessage };
        resultMessageText = failureMessage;
      }

      if (!isLogicalFailure) {
        await saveStep6Result(pool, migrationId, result);
      }

      const finishClient6 = await pool.connect();
      try {
        await finishClient6.query('BEGIN');
        await finishClient6.query('UPDATE migration_steps SET status = $1, result = $2, status_message = $3 WHERE id = $4', [
          isLogicalFailure ? 'failed' : 'completed', result, isLogicalFailure ? failureMessage : 'Mapping verification completed.', step_id,
        ]);

        const { rows: migRowsFinal } = await finishClient6.query('SELECT workflow_state FROM migrations WHERE id = $1', [migrationId]);
        const migDataFinal = migRowsFinal[0];
        const { nextState, progress, totalSteps, completedCount } = updateWorkflowForStep(migDataFinal?.workflow_state, stepRecord.workflow_step_id || step_id, result, isLogicalFailure);
        
        await finishClient6.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4, current_step = $5 WHERE id = $6', [
          nextState, progress, isLogicalFailure ? 'paused' : 'processing', isLogicalFailure ? 'failed' : 'completed', currentStepNumber, migrationId,
        ]);
        await finishClient6.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
        
        if (!isLogicalFailure) {
          await incrementGlobalStats(finishClient6, { steps: 1, success: 1, total_agents: 1 });
        } else {
          await incrementGlobalStats(finishClient6, { total_agents: 1 });
        }

        await finishClient6.query('COMMIT');

        if (isLogicalFailure) {
          if (result?.verification_report && result.verification_report.is_complete === false) {
            let message = `Die Überprüfung hat ergeben, dass das Mapping noch **unvollständig** ist.\n\n`;
            
            if (result.summary) {
              message += `${result.summary}\n\n`;
            }
            
            if (result.verification_report.missing_entities && result.verification_report.missing_entities.length > 0) {
              message += `**Fehlende Entitäten:** ${result.verification_report.missing_entities.join(', ')}\n`;
            }
            
            if (result.verification_report.target_readiness?.missing_required_fields && result.verification_report.target_readiness.missing_required_fields.length > 0) {
              message += `**Fehlende Pflichtfelder:**\n`;
              result.verification_report.target_readiness.missing_required_fields.forEach((f) => {
                message += `- ${f.targetEntity}: ${f.field}\n`;
              });
            }

            message += `\nBitte passen Sie die Regeln im Mapping-Panel an und starten Sie die Verifizierung erneut.`;
            await writeChatMessage(migrationId, 'assistant', message, currentStepNumber);
          } else {
            await writeChatMessage(migrationId, 'assistant', `Schritt 6 Mapping Verification fehlgeschlagen: ${failureMessage}`, currentStepNumber);
          }
          await writeRetryAction(migrationId, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt Mapping Verification fehlgeschlagen.`);
        } else {
          if (result.summary) {
            await writeChatMessage(migrationId, 'assistant', result.summary, currentStepNumber);
          }
          
          await writeChatMessage(migrationId, 'assistant', `Schritt 6 **Mapping Verification** erfolgreich abgeschlossen.`, currentStepNumber);
          
          const nextStepIndex = currentStepNumber;
          if (nextStepIndex < AGENT_WORKFLOW_STEPS.length) {
              const nextStep = AGENT_WORKFLOW_STEPS[nextStepIndex];
              const actionContent = JSON.stringify({
                  type: "action",
                  actions: [
                    { action: "continue", label: `Weiter zu Schritt ${nextStepIndex + 1} ${nextStep.title}`, variant: "primary" },
                    { action: "retry", label: `Schritt ${currentStepNumber} wiederholen`, variant: "outline", stepNumber: currentStepNumber }
                  ]
              });
              await writeChatMessage(migrationId, 'system', actionContent, currentStepNumber);
          }
          await logActivity(migrationId, 'success', 'Mapping Verification erfolgreich abgeschlossen.');
        }
      } catch (e) {
        await finishClient6.query('ROLLBACK');
        throw e;
      } finally {
        finishClient6.release();
      }

    } else if (agentName === 'runMappingRules' || agentName === 'runEnhancementRules') {
      const context = {
        migrationId,
        stepNumber: currentStepNumber,
        writeChatMessage: async (role, content, stepNum) => await writeChatMessage(migrationId, role, content, stepNum),
        logActivity: async (type, title) => await logActivity(migrationId, type, title),
        getConnector: async () => null,
        getMigrationDetails: async () => null,
        dbPool: pool
      };

      const agent = await StepFactory.createAgent(agentName, context);
      if (agent) {
        try {
          await agent.execute(agentParams);
        } catch (err) {
          console.error(`[${agentName}] Failed`, err);
        }
      } else {
        console.error(`Agent not found in StepFactory: ${agentName}`);
      }

      await pool.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
      return;

    } else if (agentName === 'runQualityEnhancement') {
      const context = {
        migrationId,
        stepNumber: currentStepNumber,
        writeChatMessage: async (role, content, stepNum) => await writeChatMessage(migrationId, role, content, stepNum),
        logActivity: async (type, title) => await logActivity(migrationId, type, title),
        getConnector: async () => null,
        getMigrationDetails: async () => null,
        dbPool: pool
      };

      const agent = await StepFactory.createAgent(agentName, context);
      if (agent) {
        try {
          const agentResult = await agent.execute(agentParams);
          isLogicalFailure = !!agentResult.isLogicalFailure;
          failureMessage = agentResult.error || "";
          result = agentResult.result || agentResult;
          resultMessageText = JSON.stringify(result);
        } catch (err) {
          isLogicalFailure = true;
          failureMessage = String(err);
          result = { error: failureMessage };
          resultMessageText = failureMessage;
        }
      } else {
        isLogicalFailure = true;
        failureMessage = "Agent not found in StepFactory";
        result = { error: failureMessage };
        resultMessageText = failureMessage;
      }

      if (!isLogicalFailure) {
        await saveStep7Result(pool, migrationId, result);
      }

      const finishClientEnhance = await pool.connect();
      try {
        await finishClientEnhance.query('BEGIN');
        await finishClientEnhance.query('UPDATE migration_steps SET status = $1, result = $2, status_message = $3 WHERE id = $4', [
          isLogicalFailure ? 'failed' : 'completed', result, isLogicalFailure ? failureMessage : 'Quality enhancement completed successfully.', step_id,
        ]);

        const { rows: migRowsFinal } = await finishClientEnhance.query('SELECT workflow_state FROM migrations WHERE id = $1', [migrationId]);
        const migrationDataFinal = migRowsFinal[0];
        const { nextState, progress, totalSteps, completedCount } = updateWorkflowForStep(migrationDataFinal?.workflow_state, stepRecord.workflow_step_id || step_id, result, isLogicalFailure);
        
        await finishClientEnhance.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4, current_step = $5 WHERE id = $6', [
          nextState, progress, isLogicalFailure ? 'paused' : 'processing', isLogicalFailure ? 'failed' : 'completed', currentStepNumber, migrationId,
        ]);
        await finishClientEnhance.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
        
        if (!isLogicalFailure) {
          await incrementGlobalStats(finishClientEnhance, { steps: 1, success: 1, total_agents: 1 });
        } else {
          await incrementGlobalStats(finishClientEnhance, { total_agents: 1 });
        }

        await finishClientEnhance.query('COMMIT');

        if (isLogicalFailure) {
           await writeChatMessage(migrationId, 'assistant', `Schritt 7 Quality Enhancement fehlgeschlagen: ${failureMessage}`, currentStepNumber);
           await writeRetryAction(migrationId, currentStepNumber);
           await logActivity(migrationId, 'warning', `Schritt Quality Enhancement fehlgeschlagen.`);
        } else {
           const { rows: scopeNameRows } = await pool.query('SELECT name, scope_config, target_system FROM migrations WHERE id = $1', [migrationId]);
           const migrationName7 = scopeNameRows[0]?.name;
           const scopeConf7 = scopeNameRows[0]?.scope_config || {};
           const tSys7 = scopeNameRows[0]?.target_system || "Zielsystem";
           
           const displayTargetName = (scopeConf7.targetName && scopeConf7.targetName !== "-") 
             ? scopeConf7.targetName 
             : (scopeConf7.sourceScopeName || migrationName7 || "Projekt");
           
           const nextStepIndex = currentStepNumber;
           if (nextStepIndex < AGENT_WORKFLOW_STEPS.length) {
               const nextStep = AGENT_WORKFLOW_STEPS[nextStepIndex];
               
               if (nextStep.id === "data-transfer") {
                 const confirmMsg = `Alles ist bereit für den Datentransfer. Ich werde im Zielsystem **${tSys7}** einen neuen Bereich namens **"${displayTargetName}"** anlegen und alle Daten dorthin übertragen. Sollen wir starten?`;
                 await writeChatMessage(migrationId, 'assistant', confirmMsg, currentStepNumber);
                 
                 const actionContent = JSON.stringify({
                     type: "action",
                     actions: [
                       { action: "continue", label: "Ja, Transfer starten", variant: "primary" },
                       { action: "retry", label: "Qualitäts-Check wiederholen", variant: "outline", stepNumber: currentStepNumber }
                     ]
                 });
                 await writeChatMessage(migrationId, 'system', actionContent, currentStepNumber);
               } else {
                 const actionContent = JSON.stringify({
                     type: "action",
                     actions: [
                       { action: "continue", label: `Weiter zu Schritt ${nextStepIndex + 1} ${nextStep.title}`, variant: "primary" },
                       { action: "retry", label: `Schritt ${currentStepNumber} wiederholen`, variant: "outline", stepNumber: currentStepNumber }
                     ]
                 });
                 await writeChatMessage(migrationId, 'system', actionContent, currentStepNumber);
               }
           }
           await logActivity(migrationId, 'success', 'Quality Enhancement abgeschlossen.');
        }
      } catch (e) {
        await finishClientEnhance.query('ROLLBACK');
        throw e;
      } finally {
        finishClientEnhance.release();
      }
      return;

    } else if (agentName === 'runDataTransfer') {
      const context = {
        migrationId,
        stepNumber: currentStepNumber,
        writeChatMessage: async (role, content, stepNum) => await writeChatMessage(migrationId, role, content, stepNum),
        upsertChatMessage: async (id, role, content, stepNum) => await upsertChatMessage(id, migrationId, role, content, stepNum),
        logActivity: async (type, title) => await logActivity(migrationId, type, title),
        getConnector: async (type) => {
            const { rows } = await pool.query('SELECT api_url, api_key, username, auth_type FROM connectors WHERE migration_id = $1 AND connector_type = $2', [migrationId, type]);
            return rows[0];
        },
        getMigrationDetails: async () => {
            const { rows } = await pool.query('SELECT name, source_system, target_system, scope_config FROM migrations WHERE id = $1', [migrationId]);
            return rows[0];
        },
        dbPool: pool
      };

      const agent = await StepFactory.createAgent(agentName, context);
      if (agent) {
        try {
          const agentResult = await agent.execute(agentParams);
          isLogicalFailure = !!agentResult.isLogicalFailure;
          failureMessage = agentResult.error || "";
          result = agentResult.result || agentResult;
          
          if (agentResult.isEarlyReturnForPlan) {
              await pool.query('UPDATE migrations SET step_status = $1, status = $2 WHERE id = $3', ['completed', 'processing', migrationId]);
              await pool.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
              return;
          }
        } catch (err) {
          isLogicalFailure = true;
          failureMessage = String(err);
          result = { error: failureMessage };
        }
      } else {
        isLogicalFailure = true;
        failureMessage = "Agent not found in StepFactory";
        result = { error: failureMessage };
      }

      const finishClientTransfer = await pool.connect();
      try {
        await finishClientTransfer.query('BEGIN');
        await finishClientTransfer.query('UPDATE migration_steps SET status = $1, result = $2, status_message = $3 WHERE id = $4', [
          isLogicalFailure ? 'failed' : 'completed', result, isLogicalFailure ? failureMessage : 'Data transfer completed.', step_id,
        ]);

        const { rows: migRowsFinal } = await finishClientTransfer.query('SELECT workflow_state FROM migrations WHERE id = $1', [migrationId]);
        const migrationDataFinal = migRowsFinal[0];
        const { nextState, progress, totalSteps, completedCount } = updateWorkflowForStep(migrationDataFinal?.workflow_state, stepRecord.workflow_step_id || step_id, result, isLogicalFailure);
        const migrationStatus = isLogicalFailure ? 'paused' : (completedCount >= totalSteps ? 'completed' : 'processing');
        const stepStatusForMigration = isLogicalFailure ? 'failed' : 'completed';

        await finishClientTransfer.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4, current_step = $5 WHERE id = $6', [
          nextState, progress, migrationStatus, stepStatusForMigration, currentStepNumber, migrationId,
        ]);
        await finishClientTransfer.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
        
        if (!isLogicalFailure) {
           await incrementGlobalStats(finishClientTransfer, { steps: 1, success: 1, total_agents: 1 });
        } else {
           await incrementGlobalStats(finishClientTransfer, { total_agents: 1 });
        }

        await finishClientTransfer.query('COMMIT');
        
        if (isLogicalFailure) {
            await writeChatMessage(migrationId, 'assistant', `Schritt 8 Data Transfer fehlgeschlagen: ${failureMessage}`, currentStepNumber);
            await writeRetryAction(migrationId, currentStepNumber);
            await logActivity(migrationId, 'warning', `Schritt Data Transfer fehlgeschlagen.`);
        } else {
            const nextStepIndex = currentStepNumber;
            if (nextStepIndex < AGENT_WORKFLOW_STEPS.length) {
                const nextStep = AGENT_WORKFLOW_STEPS[nextStepIndex];
                const actionContent = JSON.stringify({
                    type: "action",
                    actions: [
                      { action: "continue", label: `Weiter zu Schritt ${nextStepIndex + 1} ${nextStep.title}`, variant: "primary" },
                      { action: "retry", label: `Schritt ${currentStepNumber} wiederholen`, variant: "outline", stepNumber: currentStepNumber }
                    ]
                });
                await writeChatMessage(migrationId, 'system', actionContent, currentStepNumber);
            }
            await logActivity(migrationId, 'success', 'Data Transfer abgeschlossen.');
        }
      } catch (e) {
        await finishClientTransfer.query('ROLLBACK');
        throw e;
      } finally {
        finishClientTransfer.release();
      }
      return;

    } else {
      throw new Error(`Agent ${agentName} is not yet implemented in the worker.`);
    }
    console.log(`Job ${job.id} completed successfully.`);

  } catch (error) {
    console.error(`Error processing job ${job.id}:`, error);
    const errorMessage = (error as Error).message;
    const errorClient = await pool.connect();
    try {
      await errorClient.query('BEGIN');
      await errorClient.query('UPDATE migration_steps SET status = $1, status_message = $2 WHERE id = $3', ['failed', errorMessage, step_id]);
      const { rows: migrationRows } = await errorClient.query('SELECT workflow_state FROM migrations WHERE id = $1', [migrationId]);
      const migrationData = migrationRows[0];
      const { nextState, progress } = updateWorkflowForStep(migrationData?.workflow_state, stepRecord.workflow_step_id || step_id, errorMessage, true);
      await errorClient.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4 WHERE id = $5', [nextState, progress, 'paused', 'failed', migrationId]);
      await errorClient.query('UPDATE jobs SET status = $1, last_error = $2 WHERE id = $3', ['failed', errorMessage, job.id]);
      
      // KPI: Increment global stats (only total attempts)
      await incrementGlobalStats(errorClient, { total_agents: 1 });

      await errorClient.query('COMMIT');
      await writeChatMessage(migrationId, 'assistant', `Error: ${errorMessage}`, currentStepNumber);
      await writeRetryAction(migrationId, currentStepNumber);
      await logActivity(migrationId, 'error', `Schritt fehlgeschlagen: ${errorMessage}`);
    } catch (e2) {
      await errorClient.query('ROLLBACK');
      console.error('Error in error handling:', e2);
    } finally {
      errorClient.release();
    }
  }
}

async function pollForJobs() {
  const { rows: jobs } = await pool.query("SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1");
  const job = jobs?.[0];
  if (!job) return;
  await pool.query('UPDATE jobs SET status = $1, attempts = $2 WHERE id = $3', ['running', (job.attempts || 0) + 1, job.id]);
  await processJob(job);
}

function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not found. The worker cannot start.');
    process.exit(1);
  }
  console.log('Worker started.');
  setInterval(() => pollForJobs(), POLL_INTERVAL);
}

main();