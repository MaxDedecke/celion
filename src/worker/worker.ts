import { Pool } from 'pg';
import { runSystemDetection } from '../agents/agentService';
import { AGENT_WORKFLOW_STEPS } from '../constants/agentWorkflow';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const POLL_INTERVAL = 5000; // 5 seconds

async function logActivity(migrationId: string, type: 'success' | 'error' | 'info' | 'warning', title: string) {
  const timestamp = new Date().toISOString();
  await pool.query('INSERT INTO migration_activities (migration_id, type, title, timestamp) VALUES (, $2, $3, $4)', [
    migrationId,
    type,
    title,
    timestamp,
  ]);
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
    const { rows: stepRows } = await client.query('SELECT id, migration_id, workflow_step_id, name FROM migration_steps WHERE id = ', [step_id]);
    const stepRecord = stepRows[0];

    if (!stepRecord) {
      console.error('Unable to find migration step for job', job.id);
      await client.query('UPDATE jobs SET status = , last_error = $2 WHERE id = $3', ['failed', 'Step not found', job.id]);
      return;
    }

    const migrationId = stepRecord.migration_id;

    await client.query('BEGIN');
    await client.query('UPDATE migration_steps SET status =  WHERE id = $2', ['running', step_id]);
    await client.query('UPDATE migrations SET status =  WHERE id = $2', ['processing', migrationId]);

    try {
      let result: any;
      if (agentName === 'runSystemDetection') {
        const url = agentParams?.sourceUrl || agentParams?.url;
        const expected = agentParams?.sourceExpectedSystem || agentParams?.expectedSystem;

        const messageGenerator = runSystemDetection(url, expected);
        let lastMessageText: string | undefined;

        for await (const message of messageGenerator) {
          if (message.message.content.text) {
            lastMessageText = message.message.content.text;
          }
        }

        if (lastMessageText) {
          try {
            result = JSON.parse(lastMessageText);
          } catch (e) {
            result = { text: lastMessageText };
          }
        } else {
          result = { error: 'Agent produced no output' };
        }
      } else {
        throw new Error(`Agent ${agentName} is not yet implemented in the worker.`);
      }

      await client.query('UPDATE migration_steps SET status = , result = $2, status_message = $3 WHERE id = $4', [
        'completed',
        result,
        'Agent run completed successfully.',
        step_id,
      ]);

      const { rows: migrationRows } = await client.query('SELECT workflow_state FROM migrations WHERE id = ', [migrationId]);
      const migrationData = migrationRows[0];

      const { nextState, progress, totalSteps, completedCount } = updateWorkflowForStep(
        migrationData?.workflow_state,
        stepRecord.workflow_step_id || stepId,
        result,
        false
      );

      const migrationStatus = completedCount >= totalSteps ? 'completed' : 'running';

      await client.query('UPDATE migrations SET workflow_state = , progress = $2, status = $3 WHERE id = $4', [
        nextState,
        progress,
        migrationStatus,
        migrationId,
      ]);

      await logActivity(migrationId, 'success', `Schritt abgeschlossen: ${stepRecord.name}`);

      await client.query('UPDATE jobs SET status =  WHERE id = $2', ['completed', job.id]);

      console.log(`Job ${job.id} completed successfully.`);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`Error processing job ${job.id}:`, error);
      const errorMessage = (error as Error).message;

      const client2 = await pool.connect();
      try {
        await client2.query('BEGIN');
        await client2.query('UPDATE migration_steps SET status = , status_message = $2 WHERE id = $3', ['failed', errorMessage, step_id]);

        const { rows: migrationRows } = await client2.query('SELECT workflow_state FROM migrations WHERE id = ', [migrationId]);
        const migrationData = migrationRows[0];

        const { nextState, progress } = updateWorkflowForStep(
          migrationData?.workflow_state,
          stepRecord.workflow_step_id || stepId,
          errorMessage,
          true
        );

        await client2.query('UPDATE migrations SET workflow_state = , progress = $2, status = $3 WHERE id = $4', [
          nextState,
          progress,
          'paused',
          migrationId,
        ]);

        await logActivity(migrationId, 'error', `Schritt fehlgeschlagen: ${errorMessage}`);

        await client2.query('UPDATE jobs SET status = , last_error = $2 WHERE id = $3', ['failed', errorMessage, job.id]);
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

  await pool.query('UPDATE jobs SET status = , attempts = $2 WHERE id = $3', ['running', (job.attempts || 0) + 1, job.id]);

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