import { Pool } from 'pg';
import { runSystemDetection } from '../agents/agentService';
import { AGENT_WORKFLOW_STEPS } from '../constants/agentWorkflow';

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

// Hilfsfunktion zum Schreiben von Chat-Nachrichten
async function writeChatMessage(client: any, migrationId: string, role: string, content: string, stepNumber?: number) {
  await client.query(
    'INSERT INTO migration_chat_messages (migration_id, role, content, step_number) VALUES ($1, $2, $3, $4)',
    [migrationId, role, content, stepNumber]
  );
}

const ensureWorkflowState = (state: any = {}) => {
  const safeState = state || {};
  const nodes = Array.isArray(safeState.nodes) ? [...safeState.nodes] : [];
  const connections = Array.isArray(safeState.connections) ? [...safeState.connections] : [];
  return { nodes, connections };
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
  const totalSteps = nodes.length || AGENT_WORKFLOW_STEPS.length || 1;
  const progress = Math.round((completedCount / totalSteps) * 100);

  return { nextState, progress, completedCount, totalSteps };
};

async function processJob(job: any) {
  console.log(`Processing job ${job.id} for step ${job.step_id}`);

  const { step_id, payload } = job;
  const { agentName, agentParams, stepId } = payload;

  const client = await pool.connect();
  try {
    // KORREKTUR: 'step_number' aus dem SELECT entfernt
    const { rows: stepRows } = await client.query(
      'SELECT id, migration_id, workflow_step_id, name FROM migration_steps WHERE id = $1', 
      [step_id]
    );
    const stepRecord = stepRows[0];

    if (!stepRecord) {
      console.error('Unable to find migration step for job', job.id);
      await client.query('UPDATE jobs SET status = $1, last_error = $2 WHERE id = $3', ['failed', 'Step not found', job.id]);
      return;
    }

    const migrationId = stepRecord.migration_id;
    // KORREKTUR: step_number kommt jetzt sicher aus dem payload (Fallback auf 1)
    const currentStepNumber = payload.stepNumber || 1;

    await client.query('BEGIN');
    
    // Status Updates beim Start
    await client.query('UPDATE migration_steps SET status = $1 WHERE id = $2', ['running', step_id]);
    
    // WICHTIG: step_status auch auf 'running' setzen
    await client.query('UPDATE migrations SET status = $1, step_status = $2 WHERE id = $3', ['processing', 'running', migrationId]);

    // Start-Nachricht im Chat
    await writeChatMessage(client, migrationId, 'system', `Starting ${stepRecord.name || 'step'}...`, currentStepNumber);

    console.log("Agent params:", JSON.stringify(agentParams, null, 2));

    try {
      let result: any;
      let resultMessageText = "Step completed.";
      let isLogicalFailure = false;
      let failureMessage = "";

      if (agentName === 'runSystemDetection') {
        const url = agentParams?.url;
        const expected = agentParams?.expectedSystem;
        const instructions = agentParams?.instructions;
        const mode = agentParams?.mode || 'source';

        await writeChatMessage(client, migrationId, 'assistant', `Verifying ${mode === 'source' ? 'Source' : 'Target'} System: ${url}...`, currentStepNumber);
        
        const messageGenerator = runSystemDetection(url, expected, instructions);
        let lastMessageText: string | undefined;

        for await (const message of messageGenerator) {
          if (message.content && message.content.length > 0 && message.content[0].text) {
            lastMessageText = message.content[0].text;
          }
        }

        if (lastMessageText) {
          try {
            result = JSON.parse(lastMessageText);
            resultMessageText = lastMessageText; 
            
            // Explicitly check for logical failure in System Detection
            if (result && result.systemMatchesUrl === false) {
               isLogicalFailure = true;
               failureMessage = `${mode === 'source' ? 'Source' : 'Target'} system detection failed: URL does not match expected system.`;
            }

          } catch (e) {
            result = { text: lastMessageText };
            resultMessageText = lastMessageText;
          }
        } else {
          result = { error: 'Agent produced no output' };
          resultMessageText = "Agent finished with no output.";
          isLogicalFailure = true;
          failureMessage = "Agent produced no output.";
        }

        // Check if this is the last job for this step
        const { rows: otherJobs } = await client.query(
          "SELECT id FROM jobs WHERE step_id = $1 AND id != $2 AND status IN ('pending', 'running')",
          [step_id, job.id]
        );
        const isLastJob = otherJobs.length === 0;

        // Fetch current step state to merge results
        const { rows: currentStepRows } = await client.query('SELECT result, status FROM migration_steps WHERE id = $1', [step_id]);
        const existingResult = currentStepRows[0]?.result || {};
        const stepHadFailure = currentStepRows[0]?.status === 'failed';
        
        const combinedStepResult = { ...existingResult, [mode]: result };
        const finalStepStatus = (isLogicalFailure || stepHadFailure) ? 'failed' : (isLastJob ? 'completed' : 'running');

        // 1. Update migration_steps
        await client.query('UPDATE migration_steps SET status = $1, result = $2, status_message = $3 WHERE id = $4', [
          finalStepStatus,
          combinedStepResult,
          isLogicalFailure ? failureMessage : (isLastJob ? 'All detections completed successfully.' : `Detection for ${mode} completed.`),
          step_id,
        ]);

        const { rows: migrationRows } = await client.query('SELECT workflow_state FROM migrations WHERE id = $1', [migrationId]);
        const migrationData = migrationRows[0];

        // We only update the workflow node status to 'done' if the WHOLE step is done
        const { nextState, progress, totalSteps, completedCount } = updateWorkflowForStep(
          migrationData?.workflow_state,
          stepRecord.workflow_step_id || stepId,
          combinedStepResult,
          (isLogicalFailure || stepHadFailure)
        );

        // If not last job and not failed, we keep status as 'processing' / 'running'
        const migrationStatus = (isLogicalFailure || stepHadFailure) ? 'paused' : (isLastJob && completedCount >= totalSteps ? 'completed' : 'processing');
        const stepStatusForMigration = (isLogicalFailure || stepHadFailure) ? 'failed' : (isLastJob ? 'completed' : 'running');

        // 2. Update migrations
        await client.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4, current_step = $5 WHERE id = $6', [
          nextState,
          progress,
          migrationStatus,
          stepStatusForMigration,        
          currentStepNumber,  
          migrationId,
        ]);

        // 3. Chat Nachricht schreiben
        await writeChatMessage(client, migrationId, 'assistant', resultMessageText, currentStepNumber);

        if (isLogicalFailure) {
          await writeChatMessage(client, migrationId, 'system', `Schritt ${currentStepNumber} (${mode}) fehlgeschlagen.`, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt ${mode}-Erkennung fehlgeschlagen.`);
        } else {
          await logActivity(migrationId, 'success', `Schritt ${mode}-Erkennung abgeschlossen.`);
        }

      } else {
        // Generic handling for other agents (non-split)
        // ... (the rest of the implementation for non-system-detection agents)
        throw new Error(`Agent ${agentName} is not yet implemented in the worker.`);
      }

      await client.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);

      console.log(`Job ${job.id} completed successfully (Logical Failure: ${isLogicalFailure}).`);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`Error processing job ${job.id}:`, error);
      const errorMessage = (error as Error).message;

      const client2 = await pool.connect();
      try {
        await client2.query('BEGIN');
        await client2.query('UPDATE migration_steps SET status = $1, status_message = $2 WHERE id = $3', ['failed', errorMessage, step_id]);

        const { rows: migrationRows } = await client2.query('SELECT workflow_state FROM migrations WHERE id = $1', [migrationId]);
        const migrationData = migrationRows[0];

        const { nextState, progress } = updateWorkflowForStep(
          migrationData?.workflow_state,
          stepRecord.workflow_step_id || stepId,
          errorMessage,
          true
        );

        // Auch im Fehlerfall step_status updaten
        await client2.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4 WHERE id = $5', [
          nextState,
          progress,
          'paused',
          'failed',
          migrationId,
        ]);
        
        await writeChatMessage(client2, migrationId, 'system', `Error: ${errorMessage}`, currentStepNumber);

        await logActivity(migrationId, 'error', `Schritt fehlgeschlagen: ${errorMessage}`);

        await client2.query('UPDATE jobs SET status = $1, last_error = $2 WHERE id = $3', ['failed', errorMessage, job.id]);
        await client2.query('COMMIT');
      } catch (e2) {
        await client2.query('ROLLBACK');
        console.error('Error in error handling:', e2);
      } finally {
        client2.release();
      }
    }
  } finally {
    client.release();
  }
}

async function pollForJobs() {
  console.log('Polling for new jobs...');

  const { rows: jobs } = await pool.query(
    "SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
  );

  const job = jobs?.[0];
  if (!job) {
    return; // No pending jobs
  }

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