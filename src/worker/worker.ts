
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { runSystemDetectionAgent } from '../agents/agentService';
import type { AgentName } from '../types/agents';

// TODO: Move these to a central configuration
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase credentials not found. The worker cannot start.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const POLL_INTERVAL = 5000; // 5 seconds

async function processJob(job: any, supabase: SupabaseClient) {
  console.log(`Processing job ${job.id} for step ${job.step_id}`);

  const { step_id, payload } = job;
  const { agentName, agentParams } = payload;

  // 1. Update step status to 'running'
  await supabase.from('migration_steps').update({ status: 'running' }).eq('id', step_id);

  try {
    // 2. Run the actual agent
    let result: any;
    if (agentName === 'runSystemDetection') {
      result = await runSystemDetectionAgent(agentParams.url, agentParams.expectedSystem);
    } else {
      throw new Error(`Agent ${agentName} is not yet implemented in the worker.`);
    }

    // 3. Update step status to 'completed' with the result
    await supabase
      .from('migration_steps')
      .update({ status: 'completed', result, status_message: 'Agent run completed successfully.' })
      .eq('id', step_id);

    // 4. Update job status to 'completed'
    await supabase.from('jobs').update({ status: 'completed' }).eq('id', job.id);

    console.log(`Job ${job.id} completed successfully.`);

  } catch (error) {
    console.error(`Error processing job ${job.id}:`, error);
    const errorMessage = (error as Error).message;

    // 5. Update step status to 'failed'
    await supabase
      .from('migration_steps')
      .update({ status: 'failed', status_message: errorMessage })
      .eq('id', step_id);

    // 6. Update job status to 'failed'
    await supabase.from('jobs').update({ status: 'failed', last_error: errorMessage }).eq('id', job.id);
  }
}

async function pollForJobs(supabase: SupabaseClient) {
  console.log('Polling for new jobs...');

  // Fetch a pending job and lock it by setting its status to 'running'
  // This is a simple "advisory lock" to prevent multiple workers from picking up the same job.
  const { data: job, error } = await supabase
    .from('jobs')
    .update({ status: 'running' })
    .eq('status', 'pending')
    .select()
    .single();

  if (error || !job) {
    if (error && error.code !== 'PGRST116') { // PGRST116 = "No rows found"
      console.error('Error polling for jobs:', error);
    }
    return; // No pending jobs
  }

  await processJob(job, supabase);
}

function main() {
  console.log('Worker started.');
  setInterval(() => pollForJobs(supabase), POLL_INTERVAL);
}

main();
