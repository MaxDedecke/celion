import { Pool } from 'pg';
import { runSystemDetection, runAuthFlow, runSourceDiscovery, runTargetDiscovery, runAnswerAgent, runModelMapping } from '../agents/agentService';
import { AGENT_WORKFLOW_STEPS } from '../constants/agentWorkflow';
import { loadScheme, loadObjectScheme } from '../lib/scheme-loader';

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

// Result Persistence Helpers
async function saveStep1Result(migrationId: string, mode: string, result: any) {
  await pool.query(
    `INSERT INTO public.step_1_results (migration_id, system_mode, detected_system, confidence_score, api_type, api_subtype, recommended_base_url, raw_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (migration_id, system_mode) DO UPDATE SET
       detected_system = EXCLUDED.detected_system,
       confidence_score = EXCLUDED.confidence_score,
       api_type = EXCLUDED.api_type,
       api_subtype = EXCLUDED.api_subtype,
       recommended_base_url = EXCLUDED.recommended_base_url,
       raw_json = EXCLUDED.raw_json,
       created_at = now()`,
    [
      migrationId, mode, 
      result.detected_system || result.systemName, 
      result.confidenceScore, 
      result.apiTypeDetected, 
      result.apiSubtype, 
      result.recommendedBaseUrl, 
      result
    ]
  );
}

async function saveStep2Result(migrationId: string, mode: string, result: any) {
  await pool.query(
    `INSERT INTO public.step_2_results (migration_id, system_mode, is_authenticated, auth_type, error_message, raw_json)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (migration_id, system_mode) DO UPDATE SET
       is_authenticated = EXCLUDED.is_authenticated,
       auth_type = EXCLUDED.auth_type,
       error_message = EXCLUDED.error_message,
       raw_json = EXCLUDED.raw_json,
       created_at = now()`,
    [
      migrationId, mode, 
      result.authenticated ?? result.success, 
      result.authType || result.auth_method, 
      result.error || result.error_message, 
      result
    ]
  );
}

async function saveStep3Result(migrationId: string, result: any) {
  // 1. Update overall complexity score
  if (result.complexityScore !== undefined) {
    await pool.query('UPDATE public.migrations SET complexity_score = $1 WHERE id = $2', [result.complexityScore, migrationId]);
  }

  // 2. Save entities (Inventory)
  if (result.entities && Array.isArray(result.entities)) {
    for (const entity of result.entities) {
      await pool.query(
        `INSERT INTO public.step_3_results (migration_id, entity_name, count, complexity, error_message, raw_json)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (migration_id, entity_name) DO UPDATE SET
           count = EXCLUDED.count,
           complexity = EXCLUDED.complexity,
           error_message = EXCLUDED.error_message,
           raw_json = EXCLUDED.raw_json,
           created_at = now()`,
        [migrationId, entity.name, entity.count || 0, entity.complexity, entity.error, entity]
      );
    }
  }
}

async function saveStep4Result(migrationId: string, result: any) {
  await pool.query(
    `INSERT INTO public.step_4_results (
      migration_id, target_scope_id, target_scope_name, target_status, 
      writable_entities, missing_permissions, summary, raw_json
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (migration_id) DO UPDATE SET
       target_scope_id = EXCLUDED.target_scope_id,
       target_scope_name = EXCLUDED.target_scope_name,
       target_status = EXCLUDED.target_status,
       writable_entities = EXCLUDED.writable_entities,
       missing_permissions = EXCLUDED.missing_permissions,
       summary = EXCLUDED.summary,
       raw_json = EXCLUDED.raw_json,
       created_at = now()`,
    [
      migrationId,
      result.targetScope?.id,
      result.targetScope?.name,
      result.targetScope?.status,
      result.compatibility?.writableEntities || [],
      result.compatibility?.missingPermissions || [],
      result.summary,
      result
    ]
  );
}

async function saveStep5Result(migrationId: string, result: any) {
  await pool.query(
    `INSERT INTO public.step_5_results (migration_id, summary, raw_json)
     VALUES ($1, $2, $3)
     ON CONFLICT (migration_id) DO UPDATE SET
       summary = EXCLUDED.summary,
       raw_json = EXCLUDED.raw_json,
       created_at = now()`,
    [migrationId, result.summary, result]
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
  let migrationId = payload.migrationId;
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

  if (!stepRecord && agentName !== 'runAnswerAgent') {
    console.error('Unable to find migration step for job', job.id);
    await pool.query('UPDATE jobs SET status = $1, last_error = $2 WHERE id = $3', ['failed', 'Step not found', job.id]);
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
    // Update migration status only for process-relevant agents (not for Consultant)
    if (agentName !== 'runAnswerAgent') {
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
  // Skip for Consultant
  if (agentName !== 'runAnswerAgent' && (agentParams?.mode || 'source') === 'source') {
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

      for await (const message of messageGenerator) {
        if (message.content && message.content.length > 0 && message.content[0].text) {
          lastMessageText = message.content[0].text;
        }
      }

      if (lastMessageText) {
        try {
          const parsed = JSON.parse(lastMessageText);
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

      await writeChatMessage(migrationId, 'assistant', resultMessageText, currentStepNumber);
      if (!isLogicalFailure) {
        await saveStep1Result(migrationId, mode, result);
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

        if (isLogicalFailure) {
          await writeChatMessage(migrationId, 'system', `Schritt 1 System Detection fehlgeschlagen (**${mode === 'source' ? 'Quellsystem' : 'Zielsystem'}** passt nicht).`, currentStepNumber);
          await writeRetryAction(migrationId, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt ${mode}-Erkennung fehlgeschlagen.`);
        } else {
          await writeChatMessage(migrationId, 'system', `**${mode === 'source' ? 'Quellsystem' : 'Zielsystem'}**-Analyse erfolgreich.`, currentStepNumber);
          if (isLastJob) {
             await writeChatMessage(migrationId, 'system', `Schritt 1 **System Detection** erfolgreich.`, currentStepNumber);
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
      const sourceUrl = agentParams?.sourceUrl;
      const sourceSystem = agentParams?.sourceExpectedSystem;
      const headerMsg = "Starte **Source Discovery**";
      await writeChatMessage(migrationId, 'assistant', headerMsg, currentStepNumber);
      
      const { rows: migrationDetailRows } = await pool.query('SELECT scope_config FROM migrations WHERE id = $1', [migrationId]);
      const scopeConfig = migrationDetailRows[0]?.scope_config || {};
      const { rows: connectorRows } = await pool.query('SELECT api_url, api_key, username FROM connectors WHERE migration_id = $1 AND connector_type = $2', [migrationId, 'in']);
      const connector = connectorRows[0];

      if (!connector || (!connector.api_key && !connector.username)) {
        isLogicalFailure = true;
        failureMessage = `Keine Zugangsdaten für das Quellsystem gefunden.`;
        result = { success: false, error: failureMessage };
        resultMessageText = failureMessage;
      } else {
        const fullScheme = await loadScheme(sourceSystem);
        const discoveryScheme = { ...(fullScheme || {}), apiBaseUrl: fullScheme?.apiBaseUrl, headers: fullScheme?.headers };
        const detailMsg = `Ich analysiere die Struktur von **${sourceSystem}** und ermittle die Datenmengen${scopeConfig?.sourceScope ? ` (Fokus: **${scopeConfig.sourceScope}**)` : ''}.`;
        await writeChatMessage(migrationId, 'assistant', detailMsg, currentStepNumber);

        const messageGenerator = runSourceDiscovery(sourceUrl, discoveryScheme, { email: connector.username, apiToken: connector.api_key }, scopeConfig);
        let lastMessageText: string | undefined;
        for await (const message of messageGenerator) {
          if (message.content && message.content.length > 0 && message.content[0].text) {
            lastMessageText = message.content[0].text;
            if (!lastMessageText.trim().startsWith('{')) {
              await writeChatMessage(migrationId, 'assistant', lastMessageText, currentStepNumber);
            }
          }
        }

        if (lastMessageText) {
          try {
            const parsed = JSON.parse(lastMessageText);
            result = parsed;
            resultMessageText = JSON.stringify(parsed);
            if (result.error || (!result.entities || result.entities.length === 0)) {
              isLogicalFailure = true;
              failureMessage = result.error || "Keine Daten zur Migration gefunden (Discovery leer).";
            }
          } catch (e) {
            result = { text: lastMessageText };
            resultMessageText = JSON.stringify(result);
            isLogicalFailure = true;
            failureMessage = "Agent lieferte kein gültiges JSON Ergebnis.";
          }
        } else {
          result = { error: 'Discovery agent produced no output' };
          resultMessageText = JSON.stringify(result);
          isLogicalFailure = true;
          failureMessage = "Discovery agent produced no output.";
        }
      }

      await writeChatMessage(migrationId, 'assistant', resultMessageText, currentStepNumber);
      if (!isLogicalFailure) {
        await saveStep3Result(migrationId, result);
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
        const { nextState, progress, totalSteps, completedCount } = updateWorkflowForStep(migrationData?.workflow_state, stepRecord.workflow_step_id || stepId, combinedStepResult, isLogicalFailure);
        const migrationStatus = isLogicalFailure ? 'paused' : (completedCount >= totalSteps ? 'completed' : 'processing');
        const stepStatusForMigration = isLogicalFailure ? 'failed' : 'completed';

        await finishClient.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4, current_step = $5 WHERE id = $6', [
          nextState, progress, migrationStatus, stepStatusForMigration, currentStepNumber, migrationId,
        ]);
        await finishClient.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
        await finishClient.query('COMMIT');

        if (isLogicalFailure) {
          await writeChatMessage(migrationId, 'system', `Schritt 3 Source Discovery fehlgeschlagen.`, currentStepNumber);
          await writeRetryAction(migrationId, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt Source Discovery fehlgeschlagen.`);
        } else {
          await writeChatMessage(migrationId, 'system', `Schritt 3 **Source Discovery** erfolgreich abgeschlossen.`, currentStepNumber);
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
      const targetUrl = agentParams?.targetUrl;
      const targetSystem = agentParams?.targetExpectedSystem;
      const headerMsg = "Starte **Target Discovery**";
      await writeChatMessage(migrationId, 'assistant', headerMsg, currentStepNumber);
      
      const { rows: migrationDetailRows } = await pool.query('SELECT scope_config FROM migrations WHERE id = $1', [migrationId]);
      const scopeConfig = migrationDetailRows[0]?.scope_config || {};
      const { rows: connectorRows } = await pool.query('SELECT api_url, api_key, username FROM connectors WHERE migration_id = $1 AND connector_type = $2', [migrationId, 'out']);
      const connector = connectorRows[0];

      if (!connector || (!connector.api_key && !connector.username)) {
        isLogicalFailure = true;
        failureMessage = `Keine Zugangsdaten für das Zielsystem gefunden.`;
        result = { success: false, error: failureMessage };
        resultMessageText = failureMessage;
      } else {
        const fullScheme = await loadScheme(targetSystem);
        const discoveryScheme = { ...(fullScheme || {}), apiBaseUrl: fullScheme?.apiBaseUrl, headers: fullScheme?.headers };
        const detailMsg = `Ich analysiere die Kompatibilität von **${targetSystem}**${scopeConfig?.targetName ? ` (Ziel-Scope: **${scopeConfig.targetName}**)` : ''}.`;
        await writeChatMessage(migrationId, 'assistant', detailMsg, currentStepNumber);

        const messageGenerator = runTargetDiscovery(targetUrl, discoveryScheme, { email: connector.username, apiToken: connector.api_key }, scopeConfig);
        let lastMessageText: string | undefined;
        for await (const message of messageGenerator) {
          if (message.content && message.content.length > 0 && message.content[0].text) {
            lastMessageText = message.content[0].text;
            if (!lastMessageText.trim().startsWith('{')) {
              await writeChatMessage(migrationId, 'assistant', lastMessageText, currentStepNumber);
            }
          }
        }

        if (lastMessageText) {
          try {
            const parsed = JSON.parse(lastMessageText);
            result = parsed;
            resultMessageText = JSON.stringify(parsed);
            if (result.targetScope?.status === 'not_found' || result.targetScope?.status === 'unauthorized' || result.targetScope?.status === 'conflict') {
              isLogicalFailure = true;
              failureMessage = result.summary || `Ziel-Konfiguration fehlerhaft: ${result.targetScope?.status}`;
            }
          } catch (e) {
            result = { text: lastMessageText };
            resultMessageText = JSON.stringify(result);
            isLogicalFailure = true;
            failureMessage = "Agent lieferte kein gültiges JSON Ergebnis.";
          }
        } else {
          result = { error: 'Target agent produced no output' };
          resultMessageText = JSON.stringify(result);
          isLogicalFailure = true;
          failureMessage = "Target agent produced no output.";
        }
      }

      await writeChatMessage(migrationId, 'assistant', resultMessageText, currentStepNumber);
      if (!isLogicalFailure) {
        await saveStep4Result(migrationId, result);
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
        const { nextState, progress, totalSteps, completedCount } = updateWorkflowForStep(migrationData?.workflow_state, stepRecord.workflow_step_id || stepId, combinedStepResult, isLogicalFailure);
        const migrationStatus = isLogicalFailure ? 'paused' : (completedCount >= totalSteps ? 'completed' : 'processing');
        const stepStatusForMigration = isLogicalFailure ? 'failed' : 'completed';

        await finishClient.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4, current_step = $5 WHERE id = $6', [
          nextState, progress, migrationStatus, stepStatusForMigration, currentStepNumber, migrationId,
        ]);
        await finishClient.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
        await finishClient.query('COMMIT');

        if (isLogicalFailure) {
          await writeChatMessage(migrationId, 'system', `Schritt 4 Target Discovery fehlgeschlagen.`, currentStepNumber);
          await writeRetryAction(migrationId, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt Target Discovery fehlgeschlagen.`);
        } else {
          await writeChatMessage(migrationId, 'system', `Schritt 4 **Target Discovery** erfolgreich abgeschlossen.`, currentStepNumber);
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
      const url = agentParams?.url;
      const systemName = agentParams?.expectedSystem;
      const mode = agentParams?.mode || 'source';
      const headerMsg = mode === 'source' ? "Verifiziere **Quellsystem-Authentifizierung**" : "Verifiziere **Zielsystem-Authentifizierung**";
      await writeChatMessage(migrationId, 'assistant', headerMsg, currentStepNumber);
      
      const { rows: connectorRows } = await pool.query('SELECT api_url, api_key, username FROM connectors WHERE migration_id = $1 AND connector_type = $2', [migrationId, mode === 'source' ? 'in' : 'out']);
      const connector = connectorRows[0];

      if (!connector || (!connector.api_key && !connector.username)) {
        isLogicalFailure = true;
        failureMessage = `Keine Zugangsdaten für **${mode === 'source' ? 'Quellsystem' : 'Zielsystem'}** gefunden.`;
        result = { success: false, error: failureMessage };
        resultMessageText = failureMessage;
      } else {
        const fullScheme = await loadScheme(systemName);
        const authScheme = { ...(fullScheme?.authentication || {}), apiBaseUrl: fullScheme?.apiBaseUrl, headers: fullScheme?.headers };
        const detailMsg = `Ich teste die Verbindung zu **${systemName}** (**${url}**) mit den hinterlegten Zugangsdaten basierend auf der Konfiguration für **${fullScheme?.system || systemName}**.`;
        await writeChatMessage(migrationId, 'assistant', detailMsg, currentStepNumber);

        const messageGenerator = runAuthFlow(url, authScheme, { email: connector.username, apiToken: connector.api_key });
        let lastMessageText: string | undefined;
        for await (const message of messageGenerator) {
          if (message.content && message.content.length > 0 && message.content[0].text) {
            lastMessageText = message.content[0].text;
          }
        }
        if (lastMessageText) {
          try {
            const parsed = JSON.parse(lastMessageText);
            parsed.system_mode = mode;
            result = parsed;
            resultMessageText = JSON.stringify(parsed);
            if (result && result.success === false) {
               isLogicalFailure = true;
               failureMessage = `${mode === 'source' ? 'Source' : 'Target'} authentication failed: ${result.error || 'Unknown error'}`;
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
      }

      await writeChatMessage(migrationId, 'assistant', resultMessageText, currentStepNumber);
      if (!isLogicalFailure) {
        await saveStep2Result(migrationId, mode, result);
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
        const { nextState, progress, totalSteps, completedCount } = updateWorkflowForStep(migrationData?.workflow_state, stepRecord.workflow_step_id || stepId, combinedStepResult, (isLogicalFailure || stepHadFailure));
        const migrationStatus = (isLogicalFailure || stepHadFailure) ? 'paused' : (isLastJob && completedCount >= totalSteps ? 'completed' : 'processing');
        const stepStatusForMigration = (isLogicalFailure || stepHadFailure) ? 'failed' : (isLastJob ? 'completed' : 'running');

        await finishClient.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4, current_step = $5 WHERE id = $6', [
          nextState, progress, migrationStatus, stepStatusForMigration, currentStepNumber, migrationId,
        ]);
        await finishClient.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
        await finishClient.query('COMMIT');

        if (isLogicalFailure) {
          await writeChatMessage(migrationId, 'system', `Schritt 2 Authentication fehlgeschlagen (**${mode === 'source' ? 'Quellsystem' : 'Zielsystem'}** konnte nicht authentifiziert werden).`, currentStepNumber);
          await writeRetryAction(migrationId, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt ${mode}-Authentifizierung fehlgeschlagen.`);
        } else {
          await writeChatMessage(migrationId, 'system', `**${mode === 'source' ? 'Quellsystem' : 'Zielsystem'}** erfolgreich authentifiziert.`, currentStepNumber);
          if (isLastJob) {
             await writeChatMessage(migrationId, 'system', `Schritt 2 **Authentication** erfolgreich.`, currentStepNumber);
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
      const messageGenerator = runAnswerAgent(userMessage, context);
      let assistantResponse = "";
      for await (const message of messageGenerator) {
        if (message.content && message.content.length > 0 && message.content[0].text) {
          assistantResponse = message.content[0].text;
        }
      }
      if (assistantResponse) {
        await writeChatMessage(migrationId, 'assistant', assistantResponse);
      }
      await pool.query('UPDATE public.migrations SET consultant_status = $1 WHERE id = $2', ['idle', migrationId]);
      await pool.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
      return;

    } else if (agentName === 'runModelMapping') {
      const headerMsg = "Starte **Model Mapping**";
      await writeChatMessage(migrationId, 'assistant', headerMsg, currentStepNumber);

      // 1. Fetch Source System and Target System names from migrations table
      const { rows: migrationRows } = await pool.query(
        'SELECT source_system, target_system FROM migrations WHERE id = $1',
        [migrationId]
      );
      const sourceSystem = migrationRows[0]?.source_system;
      const targetSystem = migrationRows[0]?.target_system;

      if (!sourceSystem || !targetSystem) {
        throw new Error(`Systemkonfiguration für Migration ${migrationId} unvollständig.`);
      }

      const { rows: step3Rows } = await pool.query('SELECT entity_name, count, complexity, raw_json FROM step_3_results WHERE migration_id = $1', [migrationId]);
      const sourceEntities = step3Rows.map(r => ({ name: r.entity_name, count: r.count, complexity: r.complexity, fields: r.raw_json?.fields || [] }));

      const sourceSpecs = await loadObjectScheme(sourceSystem);
      const targetSpecs = await loadObjectScheme(targetSystem);

      if (!sourceSpecs || !targetSpecs) {
         throw new Error(`Konnte Objektspezifikationen für ${sourceSystem} oder ${targetSystem} nicht laden.`);
      }

      const detailMsg = `Ich erstelle ein Mapping zwischen **${sourceSystem}** und **${targetSystem}** für ${sourceEntities.length} Entitäten.`;
      await writeChatMessage(migrationId, 'assistant', detailMsg, currentStepNumber);

      const messageGenerator = runModelMapping(sourceEntities, sourceSpecs, targetSpecs);
      let lastMessageText: string | undefined;
      for await (const message of messageGenerator) {
        if (message.content && message.content.length > 0 && message.content[0].text) {
          lastMessageText = message.content[0].text;
        }
      }

      if (lastMessageText) {
        try {
          const parsed = JSON.parse(lastMessageText);
          result = parsed;
          resultMessageText = JSON.stringify(parsed);
        } catch (e) {
          result = { text: lastMessageText };
          resultMessageText = JSON.stringify(result);
          isLogicalFailure = true;
          failureMessage = "Agent lieferte kein gültiges JSON Ergebnis.";
        }
      } else {
        result = { error: 'Mapping agent produced no output' };
        resultMessageText = JSON.stringify(result);
        isLogicalFailure = true;
        failureMessage = "Mapping agent produced no output.";
      }

      await writeChatMessage(migrationId, 'assistant', resultMessageText, currentStepNumber);
      if (!isLogicalFailure) {
        await saveStep5Result(migrationId, result);
      }

      const finishClient = await pool.connect();
      try {
        await finishClient.query('BEGIN');
        const { rows: currentStepRows } = await finishClient.query('SELECT result, status FROM migration_steps WHERE id = $1', [step_id]);
        const existingResult = currentStepRows[0]?.result || {};
        const combinedStepResult = { ...existingResult, mapping: result };
        const finalStepStatus = isLogicalFailure ? 'failed' : 'completed';

        await finishClient.query('UPDATE migration_steps SET status = $1, result = $2, status_message = $3 WHERE id = $4', [
          finalStepStatus, combinedStepResult, isLogicalFailure ? failureMessage : 'Model mapping completed successfully.', step_id,
        ]);

        const { rows: migrationRows } = await finishClient.query('SELECT workflow_state FROM migrations WHERE id = $1', [migrationId]);
        const migrationData = migrationRows[0];
        const { nextState, progress, totalSteps, completedCount } = updateWorkflowForStep(migrationData?.workflow_state, stepRecord.workflow_step_id || stepId, combinedStepResult, isLogicalFailure);
        const migrationStatus = isLogicalFailure ? 'paused' : (completedCount >= totalSteps ? 'completed' : 'processing');
        const stepStatusForMigration = isLogicalFailure ? 'failed' : 'completed';

        await finishClient.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4, current_step = $5 WHERE id = $6', [
          nextState, progress, migrationStatus, stepStatusForMigration, currentStepNumber, migrationId,
        ]);
        await finishClient.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
        await finishClient.query('COMMIT');

        if (isLogicalFailure) {
          await writeChatMessage(migrationId, 'system', `Schritt 5 Model Mapping fehlgeschlagen.`, currentStepNumber);
          await writeRetryAction(migrationId, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt Model Mapping fehlgeschlagen.`);
        } else {
          await writeChatMessage(migrationId, 'system', `Schritt 5 **Model Mapping** erfolgreich abgeschlossen.`, currentStepNumber);
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
          await logActivity(migrationId, 'success', `Schritt Model Mapping abgeschlossen.`);
        }
      } catch (e) {
        await finishClient.query('ROLLBACK');
        throw e;
      } finally {
        finishClient.release();
      }

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
      const { nextState, progress } = updateWorkflowForStep(migrationData?.workflow_state, stepRecord.workflow_step_id || stepId, errorMessage, true);
      await errorClient.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4 WHERE id = $5', [nextState, progress, 'paused', 'failed', migrationId]);
      await errorClient.query('UPDATE jobs SET status = $1, last_error = $2 WHERE id = $3', ['failed', errorMessage, job.id]);
      await errorClient.query('COMMIT');
      await writeChatMessage(migrationId, 'system', `Error: ${errorMessage}`, currentStepNumber);
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
