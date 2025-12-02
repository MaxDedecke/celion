import type { Plugin, ViteDevServer } from 'vite';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

async function enqueueAgentStep(
  supabase: SupabaseClient,
  migrationId: string,
  agentName: string,
  agentParams: any,
  stepId?: string,
  stepName?: string,
) {
  // 1. Create or reset a step in the 'migration_steps' table
  let step = null as any;

  if (stepId) {
    const { data: existingStep, error: stepFetchError } = await supabase
      .from('migration_steps')
      .select('*')
      .eq('id', stepId)
      .maybeSingle();

    if (stepFetchError) {
      throw new Error(`Failed to load migration step: ${stepFetchError.message}`);
    }

    if (existingStep) {
      const { data: updatedStep, error: stepUpdateError } = await supabase
        .from('migration_steps')
        .update({ status: 'pending', status_message: null, result: null })
        .eq('id', stepId)
        .select()
        .single();

      if (stepUpdateError) {
        throw new Error(`Failed to reset migration step: ${stepUpdateError.message}`);
      }

      step = updatedStep;
    }
  }

  if (!step) {
    const effectiveStepName = stepName || 'Unnamed step';

    const { data: createdStep, error: stepError } = await supabase
      .from('migration_steps')
      .insert({
        migration_id: migrationId,
        name: effectiveStepName,
        status: 'pending',
      })
      .select()
      .single();

    if (stepError) {
      throw new Error(`Failed to create migration step: ${stepError.message}`);
    }

    step = createdStep;
  }

  // 2. Mark the migration as processing while the worker runs
  await supabase.from('migrations').update({ status: 'processing' }).eq('id', migrationId);

  // 3. Create a new job in the 'jobs' table
  const { error: jobError } = await supabase.from('jobs').insert({
    step_id: step.id,
    payload: { agentName, agentParams },
    status: 'pending',
  });

  if (jobError) {
    throw new Error(`Failed to enqueue job: ${jobError.message}`);
  }

  return { step };
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
        const { migrationId, stepId, stepName, agentName, agentParams } = JSON.parse(body);

        if (!migrationId || !agentName || (!stepId && !stepName)) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'migrationId, agentName and either stepId or stepName are required' }));
          return;
        }

        // Enqueue the job and create or reset the step
        await enqueueAgentStep(supabase, migrationId, agentName, agentParams, stepId, stepName);

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
