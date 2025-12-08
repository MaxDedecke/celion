import type { Plugin, ViteDevServer } from 'vite';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function enqueueAgentStep(
  migrationId: string,
  agentName: string,
  agentParams: any,
  stepId?: string,
  stepName?: string,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let step: any;
    const workflowStepId = stepId || stepName || 'step';

    if (stepId) {
      const { rows } = await client.query(
        'SELECT * FROM migration_steps WHERE migration_id = $1 AND workflow_step_id = $2',
        [migrationId, stepId],
      );
      if (rows.length > 0) {
        const { rows: updatedRows } = await client.query(
          'UPDATE migration_steps SET status = $1, status_message = $2, result = $3, workflow_step_id = $4 WHERE id = $5 RETURNING *',
          ['pending', null, null, workflowStepId, rows[0].id],
        );
        step = updatedRows[0];
      }
    }

    if (!step) {
      const effectiveStepName = stepName || 'Unnamed step';
      const { rows } = await client.query(
        'INSERT INTO migration_steps (migration_id, workflow_step_id, name, status) VALUES ($1, $2, $3, $4) RETURNING *',
        [migrationId, workflowStepId, effectiveStepName, 'pending'],
      );
      step = rows[0];
    }

    await client.query('UPDATE migrations SET status = $1 WHERE id = $2', ['processing', migrationId]);

    await client.query('INSERT INTO jobs (step_id, payload, status) VALUES ($1, $2, $3)', [
      step.id,
      { agentName, agentParams, stepId: workflowStepId },
      'pending',
    ]);

    await client.query('COMMIT');
    return { step };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function getStepStatus(stepId: string) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM migration_steps WHERE id = $1', [stepId]);
    if (rows.length === 0) {
      return null;
    }
    return rows[0];
  } finally {
    client.release();
  }
}

function agentRunnerMiddleware(server: ViteDevServer) {
  server.middlewares.use('/api/v2/migrations/run-step', async (req, res, next) => {
    if (req.method !== 'POST') {
      return next();
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const { migrationId, stepId, stepName, agentName, agentParams } = JSON.parse(body);

        if (!migrationId || !agentName || (!stepId && !stepName)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'migrationId, agentName and either stepId or stepName are required' }));
          return;
        }

        const { step } = await enqueueAgentStep(migrationId, agentName, agentParams, stepId, stepName);

        res.statusCode = 202;
        res.end(JSON.stringify({ message: 'Agent execution has been enqueued', stepId: step.id }));
      } catch (e) {
        console.error('Error enqueuing agent step:', e);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Failed to enqueue agent execution', details: (e as Error).message }));
      }
    });
  });
}

function agentStatusMiddleware(server: ViteDevServer) {
  server.middlewares.use('/api/v2/migrations/step-status', async (req, res, next) => {
    if (req.method !== 'GET') {
      return next();
    }

    const url = new URL(req.originalUrl, `http://${req.headers.host}`);
    const stepId = url.searchParams.get('stepId');

    if (!stepId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'stepId is required' }));
      return;
    }

    try {
      const step = await getStepStatus(stepId);
      if (!step) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Step not found' }));
        return;
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(step));
    } catch (e) {
      console.error('Error getting step status:', e);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Failed to get step status', details: (e as Error).message }));
    }
  });
}

export function agentRunnerPlugin(): Plugin {
  return {
    name: 'agent-runner-plugin',
    configureServer(server) {
      if (!process.env.DATABASE_URL) {
        console.warn('DATABASE_URL not found; agent runner middleware will be disabled.');
        return;
      }

      console.log('Configuring agent runner middleware...');
      agentRunnerMiddleware(server);
      agentStatusMiddleware(server);
    },
  };
}