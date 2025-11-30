
import type { Plugin, ViteDevServer } from 'vite';
import { runSystemDetectionAgent, runAuthFlowAgent, runCapabilityDiscoveryAgent } from './src/agents/agentService';
import { createClient } from '@supabase/supabase-js';
import type { AgentName } from './src/types/agents';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase URL and Key must be provided in environment variables.");
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runAgentInBackground(agentName: AgentName, agentParams: any, migrationId: string, stepId: string) {
  const updateStatus = async (status: string, message?: string, data?: any) => {
    // Here we should update the specific step, not the whole migration.
    // The database schema needs to be adjusted for this. For now, I'll update the migration.
    const { error } = await supabase
      .from('migrations')
      .update({ status, status_message: message, ...data })
      .eq('id', migrationId);

    if (error) {
      console.error(`Failed to update migration ${migrationId} status to ${status}:`, error);
    }
  };

  try {
    await updateStatus('running');

    let result: any;
    // This is where the agent runners need to be adapted for the server environment
    if (agentName === 'runSystemDetection') {
      result = await runSystemDetectionAgent(agentParams.url, agentParams.expectedSystem);
    } else if (agentName === 'runAuthFlow') {
      // result = await runAuthFlowAgent(...);
      throw new Error(`Agent ${agentName} is not yet implemented in the background runner.`);
    } else if (agentName === 'runCapabilityDiscovery') {
      // result = await runCapabilityDiscoveryAgent(...);
      throw new Error(`Agent ${agentName} is not yet implemented in the background runner.`);
    } else {
      throw new Error(`Unknown agent: ${agentName}`);
    }

    // TODO: The result from the agent should be processed and stored correctly.
    // For now, I'm just storing the whole thing.
    await updateStatus('completed', 'Agent run completed successfully.', { result: result });

  } catch (error) {
    console.error(`Error running agent for migration ${migrationId}:`, error);
    await updateStatus('failed', (error as Error).message);
  }
}

function agentRunnerMiddleware(server: ViteDevServer) {
  server.middlewares.use('/api/v2/migrations/run-step', async (req, res, next) => {
    if (req.method !== 'POST') {
      return next();
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { migrationId, stepId, agentName, agentParams } = JSON.parse(body);

        if (!migrationId || !stepId || !agentName) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'migrationId, stepId and agentName are required' }));
          return;
        }

        // Run in the background
        Promise.resolve().then(() => runAgentInBackground(agentName, agentParams, migrationId, stepId));

        res.statusCode = 202;
        res.end(JSON.stringify({ message: 'Agent execution started' }));

      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Failed to start agent execution', details: (e as Error).message }));
      }
    });
  });
}

export function agentRunnerPlugin(): Plugin {
  return {
    name: 'agent-runner-plugin',
    configureServer(server) {
      console.log('Configuring agent runner middleware...');
      agentRunnerMiddleware(server);
    },
  };
}
