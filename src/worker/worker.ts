
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { runSystemDetectionAgent } from '../agents/agentService';
import type { AgentName } from '../types/agents';
import { AGENT_WORKFLOW_STEPS } from '../constants/agentWorkflow';

// TODO: Move these to a central configuration
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase credentials not found. The worker cannot start.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const POLL_INTERVAL = 5000; // 5 seconds

type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

async function logActivity(migrationId: string, type: 'success' | 'error' | 'info' | 'warning', title: string) {
  const timestamp = new Date().toISOString();
  await supabase.from('migration_activities').insert({
    migration_id: migrationId,
    type,
    title,
    timestamp,
  });
}

const ensureWorkflowState = (state: any = {}) => {
  const nodes = Array.isArray(state.nodes) ? [...state.nodes] : [];
  const connections = Array.isArray(state.connections) ? [...state.connections] : [];
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

async function processJob(job: any, supabase: SupabaseClient) {
  console.log(`Processing job ${job.id} for step ${job.step_id}`);

  const { step_id, payload } = job;
  const { agentName, agentParams, stepId } = payload;

  const { data: stepRecord, error: stepLookupError } = await supabase
    .from('migration_steps')
    .select('id, migration_id, workflow_step_id, name')
    .eq('id', step_id)
    .maybeSingle();

  if (stepLookupError || !stepRecord) {
    console.error('Unable to find migration step for job', job.id, stepLookupError);
    await supabase.from('jobs').update({ status: 'failed' as JobStatus, last_error: 'Step not found' }).eq('id', job.id);
    return;
  }

  const migrationId = stepRecord.migration_id;

  // 1. Update step status to 'running' and mark migration as processing
  await supabase.from('migration_steps').update({ status: 'running' }).eq('id', step_id);
  await supabase.from('migrations').update({ status: 'processing' }).eq('id', migrationId);

  try {
    // 2. Run the actual agent
    let result: any;
    if (agentName === 'runSystemDetection') {
      const url = agentParams?.sourceUrl || agentParams?.url;
      const expected = agentParams?.sourceExpectedSystem || agentParams?.expectedSystem;
      result = await runSystemDetectionAgent(url, expected);
    } else {
      throw new Error(`Agent ${agentName} is not yet implemented in the worker.`);
    }

    // 3. Update step status to 'completed' with the result
    await supabase
      .from('migration_steps')
      .update({ status: 'completed', result, status_message: 'Agent run completed successfully.' })
      .eq('id', step_id);

    // 3b. Update workflow_state & progress
    const { data: migrationData } = await supabase
      .from('migrations')
      .select('workflow_state')
      .eq('id', migrationId)
      .maybeSingle();

    const { nextState, progress, totalSteps, completedCount } = updateWorkflowForStep(
      migrationData?.workflow_state,
      stepRecord.workflow_step_id || stepId,
      result,
      false
    );

    const migrationStatus = completedCount >= totalSteps ? 'completed' : 'running';

    await supabase
      .from('migrations')
      .update({ workflow_state: nextState, progress, status: migrationStatus })
      .eq('id', migrationId);

    await logActivity(migrationId, 'success', `Schritt abgeschlossen: ${stepRecord.name}`);

    // 4. Update job status to 'completed'
    await supabase.from('jobs').update({ status: 'completed' as JobStatus }).eq('id', job.id);

    console.log(`Job ${job.id} completed successfully.`);

  } catch (error) {
    console.error(`Error processing job ${job.id}:`, error);
    const errorMessage = (error as Error).message;

    // 5. Update step status to 'failed'
    await supabase
      .from('migration_steps')
      .update({ status: 'failed', status_message: errorMessage })
      .eq('id', step_id);

    const { data: migrationData } = await supabase
      .from('migrations')
      .select('workflow_state')
      .eq('id', migrationId)
      .maybeSingle();

    const { nextState, progress } = updateWorkflowForStep(
      migrationData?.workflow_state,
      stepRecord.workflow_step_id || stepId,
      errorMessage,
      true
    );

    await supabase
      .from('migrations')
      .update({ workflow_state: nextState, progress, status: 'paused' })
      .eq('id', migrationId);

    await logActivity(migrationId, 'error', `Schritt fehlgeschlagen: ${errorMessage}`);

    // 6. Update job status to 'failed'
    await supabase.from('jobs').update({ status: 'failed' as JobStatus, last_error: errorMessage }).eq('id', job.id);
  }
}

async function pollForJobs(supabase: SupabaseClient) {
  console.log('Polling for new jobs...');

  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('Error polling for jobs:', error);
    return;
  }

  const job = jobs?.[0];
  if (!job) {
    return; // No pending jobs
  }

  await supabase.from('jobs').update({ status: 'running', attempts: (job.attempts || 0) + 1 }).eq('id', job.id);

  await processJob(job, supabase);
}

function main() {
  console.log('Worker started.');
  setInterval(() => pollForJobs(supabase), POLL_INTERVAL);
}

main();
