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

// Hilfsfunktion zum Schreiben von Chat-Nachrichten (Verwendet eigene Connection für Sofort-Commit)
async function writeChatMessage(migrationId: string, role: string, content: string, stepNumber?: number) {
  await pool.query(
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

  // 1. Step Record laden (Read-only)
  const { rows: stepRows } = await pool.query(
    'SELECT id, migration_id, workflow_step_id, name FROM migration_steps WHERE id = $1', 
    [step_id]
  );
  const stepRecord = stepRows[0];

  if (!stepRecord) {
    console.error('Unable to find migration step for job', job.id);
    await pool.query('UPDATE jobs SET status = $1, last_error = $2 WHERE id = $3', ['failed', 'Step not found', job.id]);
    return;
  }

  const migrationId = stepRecord.migration_id;
  const currentStepNumber = payload.stepNumber || 1;
  const activeStep = AGENT_WORKFLOW_STEPS[currentStepNumber - 1];
  const stepTitle = activeStep?.title || stepRecord.name || 'Schritt';

  // 2. Start-Status setzen (Transaction 1 - Sofort committen)
  const startClient = await pool.connect();
  try {
    await startClient.query('BEGIN');
    await startClient.query('UPDATE migration_steps SET status = $1 WHERE id = $2', ['running', step_id]);
    await startClient.query('UPDATE migrations SET status = $1, step_status = $2 WHERE id = $3', ['processing', 'running', migrationId]);
    await startClient.query('COMMIT');
  } catch (e) {
    await startClient.query('ROLLBACK');
    throw e;
  } finally {
    startClient.release();
  }

  // Start-Nachricht im Chat (Sofort sichtbar)
  if (agentName !== 'runSystemDetection' || (agentParams?.mode || 'source') === 'source') {
    await writeChatMessage(migrationId, 'system', `Starte Schritt ${currentStepNumber} ${stepTitle}...`, currentStepNumber);
  }

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

    

            const headerMsg = mode === 'source' ? "Analysiere **Quellsystem**" : "Analysiere **Zielsystem**";

            await writeChatMessage(migrationId, 'assistant', headerMsg, currentStepNumber);

            

            const detailMsg = `Ich überprüfe, ob **${expected}** zu der URL **${url}** passt.`;

            await writeChatMessage(migrationId, 'assistant', detailMsg, currentStepNumber);

            

            const messageGenerator = runSystemDetection(url, expected, instructions);

    
      let lastMessageText: string | undefined;

      // Agent läuft... Nachrichten werden hier nicht live gestreamt (könnte man aber theoretisch)
      for await (const message of messageGenerator) {
        if (message.content && message.content.length > 0 && message.content[0].text) {
          lastMessageText = message.content[0].text;
        }
      }

      if (lastMessageText) {
        try {
          const parsed = JSON.parse(lastMessageText);
          // Enrich JSON with mode info for UI labeling
          parsed.system_mode = mode;
          result = parsed;
          resultMessageText = JSON.stringify(parsed);
          
          if (result && result.systemMatchesUrl === false) {
             isLogicalFailure = true;
             failureMessage = `${mode === 'source' ? 'Source' : 'Target'} system detection failed: URL does not match expected system.`;
          }

        } catch (e) {
          result = { text: lastMessageText, system_mode: mode };
          resultMessageText = JSON.stringify(result);
        }
      } else {
        result = { error: 'Agent produced no output', system_mode: mode };
        resultMessageText = JSON.stringify(result);
        isLogicalFailure = true;
        failureMessage = "Agent produced no output.";
      }

      // Ergebnis-Nachricht senden bevor wir den Status finalisieren (Interaktivität)
      await writeChatMessage(migrationId, 'assistant', resultMessageText, currentStepNumber);

      // 3. Abschluss-Status setzen (Transaction 2)
      const finishClient = await pool.connect();
      try {
        await finishClient.query('BEGIN');

        // Check if this is the last job
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
          stepRecord.workflow_step_id || stepId,
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
        await finishClient.query('COMMIT');

        // Abschluss-Nachrichten (Sofort)
        if (isLogicalFailure) {
          await writeChatMessage(migrationId, 'system', `Schritt 1 System Detection fehlgeschlagen (**${mode === 'source' ? 'Quellsystem' : 'Zielsystem'}** passt nicht).`, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt ${mode}-Erkennung fehlgeschlagen.`);
        } else {
          // Explicitly state success for the current part
          await writeChatMessage(migrationId, 'system', `**${mode === 'source' ? 'Quellsystem' : 'Zielsystem'}**-Analyse erfolgreich.`, currentStepNumber);

          if (isLastJob) {
             await writeChatMessage(migrationId, 'system', `Schritt 1 **System Detection** erfolgreich.`, currentStepNumber);
             
             // Inject Action Button for Next Step
             const nextStepIndex = currentStepNumber; // currentStepNumber is 1-based, so for Step 1, next index is 1 (Step 2)
             if (nextStepIndex < AGENT_WORKFLOW_STEPS.length) {
                 const nextStep = AGENT_WORKFLOW_STEPS[nextStepIndex];
                 const actionContent = JSON.stringify({
                     type: "action",
                     action: "continue",
                     label: `Weiter zu Schritt ${nextStepIndex + 1} ${nextStep.title}`
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

    } else {
      // Fallback für andere Agenten (noch nicht implementiert im Detail)
      throw new Error(`Agent ${agentName} is not yet implemented in the worker.`);
    }

    console.log(`Job ${job.id} completed successfully.`);

  } catch (error) {
    console.error(`Error processing job ${job.id}:`, error);
    const errorMessage = (error as Error).message;

    // Error Handling Transaction
    const errorClient = await pool.connect();
    try {
      await errorClient.query('BEGIN');
      await errorClient.query('UPDATE migration_steps SET status = $1, status_message = $2 WHERE id = $3', ['failed', errorMessage, step_id]);

      const { rows: migrationRows } = await errorClient.query('SELECT workflow_state FROM migrations WHERE id = $1', [migrationId]);
      const migrationData = migrationRows[0];

      const { nextState, progress } = updateWorkflowForStep(
        migrationData?.workflow_state,
        stepRecord.workflow_step_id || stepId,
        errorMessage,
        true
      );

      await errorClient.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4 WHERE id = $5', [
        nextState,
        progress,
        'paused',
        'failed',
        migrationId,
      ]);
      
      await errorClient.query('UPDATE jobs SET status = $1, last_error = $2 WHERE id = $3', ['failed', errorMessage, job.id]);
      await errorClient.query('COMMIT');
      
      // Fehler-Nachricht (Sofort)
      await writeChatMessage(migrationId, 'system', `Error: ${errorMessage}`, currentStepNumber);
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