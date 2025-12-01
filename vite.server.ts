import type { Plugin, ViteDevServer } from 'vite';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

async function enqueueAgentStep(
  supabase: SupabaseClient,
  migrationId: string,
  stepName: string,
  agentName: string,
  agentParams: any,
) {
  // 1. Create a new step in the 'migration_steps' table
  const { data: step, error: stepError } = await supabase
    .from('migration_steps')
    .insert({
      migration_id: migrationId,
      name: stepName,
      status: 'pending',
    })
    .select()
    .single();

  if (stepError) {
    throw new Error(`Failed to create migration step: ${stepError.message}`);
  }

  // 2. Create a new job in the 'jobs' table
  const { error: jobError } = await supabase.from('jobs').insert({
    step_id: step.id,
    payload: { agentName, agentParams },
    status: 'pending',
  });

  if (jobError) {
    // If job creation fails, we should probably roll back the step creation
    // For now, just log the error
    throw new Error(`Failed to enqueue job: ${jobError.message}`);
  }

  return { step, job: null }; // Should return the created job as well if needed
}

function agentRunnerMiddleware(server: ViteDevServer, supabase: SupabaseClient) {
  server.middlewares.use('/api/v2/migrations/run-step', async (req, res, next) => {
    if (req.method !== 'POST') {
      return next();
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        // The frontend will need to be adapted to send `stepName` instead of `stepId`
        const { migrationId, stepName, agentName, agentParams } = JSON.parse(body);

        if (!migrationId || !stepName || !agentName) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'migrationId, stepName and agentName are required' }));
          return;
        }

        // Enqueue the job and create the step
        await enqueueAgentStep(supabase, migrationId, stepName, agentName, agentParams);

        res.statusCode = 202;
        res.end(JSON.stringify({ message: 'Agent execution has been enqueued' }));

      } catch (e) {
        console.error('Error enqueuing agent step:', e);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Failed to enqueue agent execution', details: (e as Error).message }));
      }
    });
  });
}

export function agentRunnerPlugin(): Plugin {
  return {
    name: 'agent-runner-plugin',
    configureServer(server) {
      const supabaseUrl = process.env.VITE_SUPABASE_URL;
      const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      if (!supabaseUrl || !supabaseKey) {
        console.warn('Supabase credentials not found; agent runner middleware will be disabled.');
        return;
      }

      console.log('Configuring agent runner middleware...');
      const supabase = createClient(supabaseUrl, supabaseKey);
      agentRunnerMiddleware(server, supabase);
    },
  };
}
