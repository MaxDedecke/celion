import { Pool } from 'pg';
import neo4j from 'neo4j-driver';
import { runSystemDetection, runAuthFlow, runSourceDiscovery, runTargetDiscovery, runAnswerAgent, runMapping, runMappingVerification, runMappingRules } from '../agents/agentService';
import { AGENT_WORKFLOW_STEPS } from '../constants/agentWorkflow';
import { loadScheme, loadObjectScheme } from '../lib/scheme-loader';
import { resolveOpenAiConfig, buildOpenAiHeaders } from '../agents/openai/openaiClient';

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

async function writeMappingChatMessage(migrationId: string, role: string, content: string) {
  await pool.query(
    'INSERT INTO mapping_chat_messages (migration_id, role, content) VALUES ($1, $2, $3)',
    [migrationId, role, content]
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
    [migrationId, result.summary || 'Data Staging abgeschlossen.', result]
  );
}

async function saveStep6Result(migrationId: string, result: any) {
  await pool.query(
    `INSERT INTO public.step_6_results (migration_id, summary, raw_json)
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

const incrementGlobalStats = async (client: any, data: { steps?: number, success?: number, total_agents?: number }) => {
  const { steps = 0, success = 0, total_agents = 0 } = data;
  try {
    await client.query(`
      INSERT INTO public.global_stats 
      (day, steps_completed, agent_success_count, agent_total_count)
      VALUES (CURRENT_DATE, $1, $2, $3)
      ON CONFLICT (day) DO UPDATE SET
          steps_completed = global_stats.steps_completed + EXCLUDED.steps_completed,
          agent_success_count = global_stats.agent_success_count + EXCLUDED.agent_success_count,
          agent_total_count = global_stats.agent_total_count + EXCLUDED.agent_total_count
    `, [steps, success, total_agents]);
  } catch (e) {
    console.error('[Worker] Failed to update global stats:', e);
  }
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
  const totalSteps = 10; // We always have 10 steps in the workflow
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

  if (!stepRecord && agentName !== 'runAnswerAgent' && agentName !== 'runMappingRules') {
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
    // Update migration status only for process-relevant agents (not for Consultant or MappingRules)
    if (agentName !== 'runAnswerAgent' && agentName !== 'runMappingRules') {
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
  // Skip for Consultant and MappingRules
  if (agentName !== 'runAnswerAgent' && agentName !== 'runMappingRules' && (agentParams?.mode || 'source') === 'source') {
    await writeChatMessage(migrationId, 'assistant', `Starte Schritt ${currentStepNumber} ${stepTitle}...`, currentStepNumber);
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
        
        // KPI: Increment global steps and agent metrics
        if (finalStepStatus === 'completed') {
          await incrementGlobalStats(finishClient, { steps: 1, success: 1, total_agents: 1 });
        } else if (finalStepStatus === 'failed') {
          await incrementGlobalStats(finishClient, { total_agents: 1 });
        }

        await finishClient.query('COMMIT');

        if (isLogicalFailure) {
          await writeChatMessage(migrationId, 'assistant', `Schritt 1 System Detection fehlgeschlagen (**${mode === 'source' ? 'Quellsystem' : 'Zielsystem'}** passt nicht).`, currentStepNumber);
          await writeRetryAction(migrationId, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt ${mode}-Erkennung fehlgeschlagen.`);
        } else {
          await writeChatMessage(migrationId, 'assistant', `**${mode === 'source' ? 'Quellsystem' : 'Zielsystem'}**-Analyse erfolgreich.`, currentStepNumber);
          if (isLastJob) {
             await writeChatMessage(migrationId, 'assistant', `Schritt 1 **System Detection** erfolgreich.`, currentStepNumber);
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
        
        // KPI: Increment global steps and agent metrics
        if (finalStepStatus === 'completed') {
          await incrementGlobalStats(finishClient, { steps: 1, success: 1, total_agents: 1 });
        } else if (finalStepStatus === 'failed') {
          await incrementGlobalStats(finishClient, { total_agents: 1 });
        }

        await finishClient.query('COMMIT');

        if (isLogicalFailure) {
          await writeChatMessage(migrationId, 'assistant', `Schritt 3 Source Discovery fehlgeschlagen.`, currentStepNumber);
          await writeRetryAction(migrationId, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt Source Discovery fehlgeschlagen.`);
        } else {
          await writeChatMessage(migrationId, 'assistant', `Schritt 3 **Source Discovery** erfolgreich abgeschlossen.`, currentStepNumber);
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
        
        // KPI: Increment global steps and agent metrics
        if (finalStepStatus === 'completed') {
          await incrementGlobalStats(finishClient, { steps: 1, success: 1, total_agents: 1 });
        } else if (finalStepStatus === 'failed') {
          await incrementGlobalStats(finishClient, { total_agents: 1 });
        }

        await finishClient.query('COMMIT');

        if (isLogicalFailure) {
          await writeChatMessage(migrationId, 'assistant', `Schritt 4 Target Discovery fehlgeschlagen.`, currentStepNumber);
          await writeRetryAction(migrationId, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt Target Discovery fehlgeschlagen.`);
        } else {
          await writeChatMessage(migrationId, 'assistant', `Schritt 4 **Target Discovery** erfolgreich abgeschlossen.`, currentStepNumber);
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
        
        // KPI: Increment global steps and agent metrics
        if (finalStepStatus === 'completed') {
          await incrementGlobalStats(finishClient, { steps: 1, success: 1, total_agents: 1 });
        } else if (finalStepStatus === 'failed') {
          await incrementGlobalStats(finishClient, { total_agents: 1 });
        }

        await finishClient.query('COMMIT');

        if (isLogicalFailure) {
          await writeChatMessage(migrationId, 'assistant', `Schritt 2 Authentication fehlgeschlagen (**${mode === 'source' ? 'Quellsystem' : 'Zielsystem'}** konnte nicht authentifiziert werden).`, currentStepNumber);
          await writeRetryAction(migrationId, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt ${mode}-Authentifizierung fehlgeschlagen.`);
        } else {
          await writeChatMessage(migrationId, 'assistant', `**${mode === 'source' ? 'Quellsystem' : 'Zielsystem'}** erfolgreich authentifiziert.`, currentStepNumber);
          if (isLastJob) {
             await writeChatMessage(migrationId, 'assistant', `Schritt 2 **Authentication** erfolgreich.`, currentStepNumber);
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
      
      // Set status to thinking
      await pool.query('UPDATE migrations SET consultant_status = $1 WHERE id = $2', ['thinking', migrationId]);
      
      const { rows: migrationRows } = await pool.query('SELECT source_system FROM migrations WHERE id = $1', [migrationId]);
      const sourceSystem = migrationRows[0]?.source_system;

      const messageGenerator = runAnswerAgent(userMessage, {
          ...context,
          migrationId,
          sourceSystem
      });
      let assistantResponse = "";
      for await (const message of messageGenerator) {
        if (message.content && message.content.length > 0 && message.content[0].text) {
          assistantResponse = message.content[0].text;
        }
      }
      if (assistantResponse) {
        await writeChatMessage(migrationId, 'assistant', assistantResponse);
      }
      
      // Reset status to idle
      await pool.query('UPDATE migrations SET consultant_status = $1 WHERE id = $2', ['idle', migrationId]);

      await pool.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
      return;

    } else if (agentName === 'runDataStaging') {
      // Step 5: Data Staging
      // Technical preparation step with Agent-driven Rate-Limit Calibration and Ingestion
      console.log(`[Worker] Running Data Staging for migration ${migrationId}`);
      await writeChatMessage(migrationId, 'assistant', 'Bereite Daten für das Mapping vor (Data Staging)...', currentStepNumber);

      // --- Phase 1: Rate-Limit Calibration ---
      await writeChatMessage(migrationId, 'assistant', 'Phase 1: Initial Rate-Limit Calibration starting...', currentStepNumber);
      
      const { rows: connectorRows } = await pool.query('SELECT api_url, api_key, username, auth_type FROM connectors WHERE migration_id = $1 AND connector_type = $2', [migrationId, 'in']);
      const connector = connectorRows[0];
      const { rows: migrationRowsInfo } = await pool.query('SELECT source_system, notes FROM migrations WHERE id = $1', [migrationId]);
      const sourceSystem = migrationRowsInfo[0]?.source_system;
      const instructions = migrationRowsInfo[0]?.notes;
      const scheme = await loadScheme(sourceSystem);

      let effectiveApiUrl = scheme?.apiBaseUrl || connector?.api_url || "";
      // Strip trailing slash
      effectiveApiUrl = effectiveApiUrl.replace(/\/$/, "");

      const stagingLogs: string[] = [];
      const phase3Logs: string[] = [];
      let relRules: any[] = [];

      const { apiKey, baseUrl, projectId } = resolveOpenAiConfig();
      const openAiHeaders = buildOpenAiHeaders(apiKey, projectId);
      const openaiClient = {
        chat: {
          completions: {
            create: async (params: any) => {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 seconds timeout
              try {
                const response = await fetch(`${baseUrl}/chat/completions`, {
                  method: 'POST',
                  headers: openAiHeaders,
                  body: JSON.stringify(params),
                  signal: controller.signal
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                  const errorText = await response.text();
                  throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText} ${errorText}`);
                }
                return await response.json();
              } catch (e: any) {
                clearTimeout(timeoutId);
                throw e;
              }
            }
          }
        }
      };

      let rateLimitResult = { delay: 1.0, batch_size: 50 };

      if (connector && effectiveApiUrl) {
          const probeUrl = sourceSystem === 'ClickUp' ? `${effectiveApiUrl}/api/v2/user` : (scheme?.authentication?.whoami?.endpoint ? `${effectiveApiUrl}${scheme.authentication.whoami.endpoint}` : effectiveApiUrl);
          await writeChatMessage(migrationId, 'assistant', `Performing probe request to ${probeUrl}...`, currentStepNumber);
          
          const headers: any = { 
              "Accept": "application/json",
              ...(scheme?.headers || {})
          };
          if (connector.auth_type === 'api_key' && connector.api_key) {
              headers["Authorization"] = sourceSystem === 'ClickUp' ? connector.api_key : `Bearer ${connector.api_key}`;
          }

          try {
              const probeRes = await fetch(probeUrl, { headers });
              const resHeaders: any = {};
              probeRes.headers.forEach((v, k) => { resHeaders[k] = v; });
              const resBody = await probeRes.text();

              // LLM Analysis for Rate Limits
              const calibrationPrompt = `
                Analysiere diese API-Antwort und bestimme das optimale delay (in Sekunden, float) und die batch_size (int), 
                um sicher unter dem Rate-Limit zu bleiben. Berücksichtige Header wie 'X-RateLimit-Limit', 'Retry-After' etc.
                
                API Antwort von ${sourceSystem}:
                Status: ${probeRes.status}
                Headers: ${JSON.stringify(resHeaders)}
                Body: ${resBody.substring(0, 1000)}
                
                Gib NUR ein JSON zurück: { "delay": float, "batch_size": int }
              `;

              const calibrationGen = openaiClient.chat.completions.create({
                  model: process.env.OPENAI_MODEL || "gpt-4o-mini",
                  messages: [{ role: "user", content: calibrationPrompt }],
                  response_format: { type: "json_object" }
              });
              const calResult = await calibrationGen;
              const parsedCal = JSON.parse(calResult.choices[0].message.content || "{}");
              if (parsedCal.delay !== undefined) rateLimitResult = parsedCal;

              const frontendResult = {
                status: "success",
                phase: "Rate-Limit Calibration",
                delay: rateLimitResult.delay,
                batch_size: rateLimitResult.batch_size,
                summary: `Rate-Limits erfolgreich kalibriert: ${rateLimitResult.delay}s Verzögerung, Batch-Größe ${rateLimitResult.batch_size}.`,
                rawOutput: JSON.stringify(rateLimitResult)
              };
              await writeChatMessage(migrationId, 'assistant', JSON.stringify(frontendResult), currentStepNumber);
          } catch (e: any) {
              await writeChatMessage(migrationId, 'assistant', `Probe failed: ${e.message}. Using defaults.`, currentStepNumber);
          }
      }

      // --- Phase 2: Agent-Driven Ingestion ---
      await writeChatMessage(migrationId, 'assistant', 'Phase 2: Programmatic Data Import in Neo4j starting...', currentStepNumber);
      
      const { rows: step3Rows } = await pool.query('SELECT entity_name, count FROM step_3_results WHERE migration_id = $1', [migrationId]);
      const entities = step3Rows.map(r => ({ name: r.entity_name, count: r.count }));
      
      let totalImported = 0;
      const driver = neo4j.driver(
        process.env.NEO4J_URI || "bolt://neo4j-db:7687",
        neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "password")
      );

      const addStagingLog = (msg: string) => {
          stagingLogs.push(`[${new Date().toLocaleTimeString('de-DE')}] ${msg}`);
      };

      // Cleanup: Delete existing nodes for this migration
      const cleanupSession = driver.session();
      try {
          addStagingLog('Bereinige alte Daten in Neo4j...');
          await cleanupSession.run('MATCH (n { migration_id: $migrationId }) DETACH DELETE n', { migrationId });
      } finally {
          await cleanupSession.close();
      }

      const agentSystemPrompt = `
        Du bist ein Data Ingestion Agent für ${sourceSystem}. Deine Aufgabe ist es, Daten über die API zu sammeln und in Neo4j zu speichern.
        
        ZIELE: ${JSON.stringify(entities)}
        ENDPUNKTE: ${JSON.stringify(scheme?.discovery?.endpoints || {})}
        BASE_URL: ${effectiveApiUrl}
        ANWEISUNGEN: ${scheme?.agentInstructions || 'Keine speziellen Anweisungen.'}
        
        REGELN:
        1. Beginne beim Top-Level.
        2. Nutze IDs aus den Ergebnissen, um Platzhalter in URLs (z.B. {database_id}) zu ersetzen.
        3. Die URLs müssen IMMER mit der BASE_URL beginnen.
        4. Nutze das Tool 'fetch_and_ingest'. Es speichert die Daten und gibt dir gefundene IDs zurück.
        5. Beende den Prozess, wenn alle Ziele erreicht sind oder keine neuen Daten gefunden werden.
      `;

      let messages: any[] = [{ role: "system", content: agentSystemPrompt }];
      const tools = [{
          type: "function",
          function: {
              name: "fetch_and_ingest",
              description: "Fetch data from a URL and store it in Neo4j.",
              parameters: {
                  type: "object",
                  properties: {
                      entity_name: { type: "string" },
                      url: { type: "string", description: "Vollständige URL mit aufgelösten Platzhaltern." }
                  },
                  required: ["entity_name", "url"]
              }
          }
      }];

      const attemptedUrls = new Set<string>();

      try {
          for (let turn = 0; turn < 15; turn++) {
              const response = await openaiClient.chat.completions.create({
                  model: process.env.OPENAI_MODEL || "gpt-4o",
                  messages,
                  tools,
                  tool_choice: "auto"
              });

              const aiMessage = response.choices[0].message;
              messages.push(aiMessage);

              if (!aiMessage.tool_calls || aiMessage.tool_calls.length === 0) break;

              for (const toolCall of aiMessage.tool_calls) {
                  const args = JSON.parse(toolCall.function.arguments);
                  const { entity_name, url } = args;

                  if (attemptedUrls.has(url)) {
                      messages.push({ role: "tool", tool_call_id: toolCall.id, content: "URL already processed." });
                      continue;
                  }
                  attemptedUrls.add(url);
                  addStagingLog(`Agent fetching ${entity_name} von ${url}...`);

                  const headers: any = { 
                      "Accept": "application/json",
                      ...(scheme?.headers || {})
                  };
                  
                  // Handle Authentication generically
                  if (connector.auth_type === 'api_key' && connector.api_key) {
                      const authConfig = scheme?.authentication;
                      if (authConfig?.type === 'header') {
                          const name = authConfig.headerName || 'Authorization';
                          const prefix = authConfig.tokenPrefix !== undefined ? authConfig.tokenPrefix : 'Bearer ';
                          headers[name] = `${prefix}${connector.api_key}`;
                      } else {
                          // Fallback to Bearer if not specified
                          headers["Authorization"] = `Bearer ${connector.api_key}`;
                      }
                  } else if (connector.auth_type === 'basic' && connector.api_key) {
                      // Basic auth fallback
                      headers["Authorization"] = `Basic ${connector.api_key}`;
                  }

                  try {
                      // Determine method (Notion search needs POST)
                      let method = 'GET';
                      let body = undefined;
                      
                      if (url.includes('/search') || url.includes('/query')) {
                          method = 'POST';
                          body = JSON.stringify({});
                      }

                      const res = await fetch(url, { method, headers, body });
                      if (res.ok) {
                          const data = await res.json();
                          const items = _extractItems(data, entity_name);
                          if (items.length > 0) {
                              // USE sourceSystem as label for consistency
                              await _ingestToNeo4j(driver, sourceSystem, entity_name, items, migrationId);
                              totalImported += items.length;
                              const sampleIds = items.slice(0, 5).map((i: any) => i.id);
                              messages.push({ role: "tool", tool_call_id: toolCall.id, content: `Success. Imported ${items.length} items. Sample IDs: ${JSON.stringify(sampleIds)}` });
                              addStagingLog(`${items.length} ${entity_name} importiert.`);
                          } else {
                              messages.push({ role: "tool", tool_call_id: toolCall.id, content: "No items found in response." });
                          }
                      } else {
                          messages.push({ role: "tool", tool_call_id: toolCall.id, content: `Error: HTTP ${res.status}` });
                          addStagingLog(`Fehler beim Abruf von ${entity_name}: HTTP ${res.status}`);
                      }
                  } catch (e: any) {
                      messages.push({ role: "tool", tool_call_id: toolCall.id, content: `Fetch error: ${e.message}` });
                      addStagingLog(`Fetch-Fehler bei ${entity_name}: ${e.message}`);
                  }
                  await new Promise(r => setTimeout(r, rateLimitResult.delay * 1000));
              }
          }

          // --- End of Phase 2 Ingestion ---
          console.log(`[Worker] Phase 2 Ingestion complete. Starting Phase 3...`);
          console.log(`[Worker] Starting Phase 3 for migration ${migrationId}`);
          await writeChatMessage(migrationId, 'assistant', 'Phase 3: Automated Relationship Discovery starting...', currentStepNumber);
          
          const addPhase3Log = (msg: string) => {
              phase3Logs.push(`[${new Date().toLocaleTimeString('de-DE')}] ${msg}`);
          };

          addPhase3Log('Analysiere Datenstruktur in Neo4j...');
          
          // 1. Get Schema Samples (Entity Types + Property Keys + Sample IDs) for this migration
          const schemaSample: Record<string, any> = {};
          const idSamples: Record<string, string[]> = {};
          const schemaSession = driver.session();
          try {
              // Fetch distinct entity_type properties
              const typesRes = await schemaSession.run(
                  `MATCH (n {migration_id: $migrationId}) 
                   RETURN DISTINCT n.entity_type as type`, 
                  { migrationId }
              );
              const entityTypes = typesRes.records.map(r => r.get('type')).filter(t => t);
              console.log(`[Worker] Found entity types for discovery: ${entityTypes.join(', ')}`);
              
              for (const type of entityTypes) {
                  // Get sample properties
                  const sampleRes = await schemaSession.run(
                      `MATCH (n {migration_id: $migrationId, entity_type: $type}) 
                       RETURN properties(n) as props LIMIT 1`,
                      { migrationId, type }
                  );
                  if (sampleRes.records.length > 0) {
                      schemaSample[type] = sampleRes.records[0].get('props');
                  }

                  // Get a few sample IDs to help the agent recognize the ID format/match
                  const idsRes = await schemaSession.run(
                      `MATCH (n {migration_id: $migrationId, entity_type: $type}) 
                       RETURN n.external_id as id LIMIT 5`,
                      { migrationId, type }
                  );
                  idSamples[type] = idsRes.records.map(r => r.get('id'));
              }
          } finally {
              await schemaSession.close();
          }

          console.log(`[Worker] Schema and ID samples gathered for ${Object.keys(schemaSample).length} entity types`);

          let totalRelsCreated = 0;
          if (Object.keys(schemaSample).length > 0) {
              const discoveryPrompt = `
                Du bist eine technische Schnittstelle für das System ${sourceSystem}. Deine Antwort wird direkt von einem automatisierten Parser verarbeitet.
                
                ### STRIKTE AUSGABE-REGELN:
                1. ANTWORTE AUSSCHLIESSLICH im folgenden JSON-Format: {"rules": [{"from": "string", "to": "string", "field": "string", "type": "string"}]}
                2. Wenn du keine Beziehungen findest, antworte mit: {"rules": []}
                3. Erzeuge KEINEN Markdown-Codeblock, KEINE Erklärungen, nur das nackte JSON Objekt.
                
                ### VALIDIERUNG DES VOKABULARS:
                - Für 'from' und 'to' darfst du NUR exakte Werte aus dieser Liste verwenden: ${JSON.stringify(Object.keys(schemaSample))}
                - Für 'field' darfst du NUR exakte Property-Namen aus den unten stehenden Beispielen verwenden.
                - Jede Abweichung in der Schreibweise führt zum Systemabbruch.
                
                ### BEISPIEL FÜR EINE KORREKTE ANTWORT:
                {"rules": [{"from": "tasks", "to": "tasks", "field": "parent_id", "type": "SUBTASK_OF"}, {"from": "tasks", "to": "users", "field": "creator_id", "type": "CREATED_BY"}]}
                
                ### DATEN-KONTEXT FÜR ${sourceSystem}:
                VERFÜGBARE OBJEKTTYPEN & BEISPIELE:
                ${JSON.stringify(schemaSample, null, 2)}
                
                BEISPIEL-IDS PRO TYP (ZUM ABGLEICH):
                ${JSON.stringify(idSamples, null, 2)}
                
                ### AUFGABE:
                Analysiere die Properties auf Foreign Keys (z.B. 'parent', 'project', 'user', 'list_id'). Achte besonders auf Selbst-Referenzen (Subtasks). Nutze fachlich korrekte Beziehungsnamen für ${sourceSystem} (z.B. 'SUBTASK_OF', 'IN_LIST', 'ASSIGNED_TO').
              `;

              console.log(`[Worker] Sending Relationship Discovery prompt for ${sourceSystem} to LLM...`);
              const discoveryRes = await openaiClient.chat.completions.create({
                  model: process.env.OPENAI_MODEL || "gpt-4o",
                  messages: [{ role: "user", content: discoveryPrompt }],
                  response_format: { type: "json_object" }
              });

              const rawContent = discoveryRes.choices[0].message.content || "[]";
              console.log(`[Worker] LLM Discovery Result: ${rawContent}`);

              try {
                  const parsed = JSON.parse(rawContent);
                  if (Array.isArray(parsed)) {
                      relRules = parsed;
                  } else if (parsed.relations && Array.isArray(parsed.relations)) {
                      relRules = parsed.relations;
                  } else if (parsed.rules && Array.isArray(parsed.rules)) {
                      relRules = parsed.rules;
                  } else if (parsed.from && parsed.to && parsed.field) {
                      relRules = [parsed]; // Single object
                  }
              } catch (e) {
                  console.error(`[Worker] Failed to parse discovery rules: ${e}`);
                  addPhase3Log(`Fehler beim Parsen der Agenten-Antwort.`);
              }

              if (relRules.length > 0) {
                  console.log(`[Worker] Applying ${relRules.length} relationship rules`);
                  addPhase3Log(`${relRules.length} potenzielle Beziehungstypen identifiziert.`);
                  const linkSession = driver.session();
                  try {
                      for (const rule of relRules) {
                          // Validation: Ensure entity types exist
                          if (!schemaSample[rule.from] || !schemaSample[rule.to]) {
                              console.warn(`[Worker] Skipping rule with unknown entity types: ${rule.from} -> ${rule.to}`);
                              addPhase3Log(`-> Überspringe Regel '${rule.type}': Typ '${!schemaSample[rule.from] ? rule.from : rule.to}' unbekannt.`);
                              continue;
                          }

                          console.log(`[Worker] Applying rule: ${rule.from} --(${rule.type})--> ${rule.to} via ${rule.field}`);
                          // Link nodes by filtering on entity_type property
                          const linkQuery = `
                            MATCH (a:\`${sourceSystem}\` {migration_id: $migrationId, entity_type: $fromType})
                            MATCH (b:\`${sourceSystem}\` {migration_id: $migrationId, entity_type: $toType})
                            WHERE a.\`${rule.field}\` IS NOT NULL 
                              AND toString(a.\`${rule.field}\`) = b.external_id
                              AND a <> b
                            MERGE (a)-[r:\`${rule.type}\` {migration_id: $migrationId}]->(b)
                            RETURN count(r) as count
                          `;
                          const result = await linkSession.run(linkQuery, { 
                              migrationId, 
                              fromType: rule.from, 
                              toType: rule.to 
                          });
                          const count = result.records[0].get('count').toNumber();
                          console.log(`[Worker] Created ${count} relationships for ${rule.type}`);
                          if (count > 0) {
                              totalRelsCreated += count;
                              addPhase3Log(`-> ${count} Beziehungen vom Typ '${rule.type}' zwischen '${rule.from}' und '${rule.to}' erstellt.`);
                          } else {
                              addPhase3Log(`-> Regel '${rule.type}' identifiziert, aber keine passenden Datensätze gefunden.`);
                          }
                      }
                  } finally {
                      await linkSession.close();
                  }
              }
          }
          addPhase3Log('Phase 3 abgeschlossen.');
          
          // Final Phase 3 Summary Message
          const phase3Result = {
              status: "success",
              phase: "Relationship Discovery",
              summary: `Strukturanalyse beendet: ${totalRelsCreated} Beziehungen im Graph automatisch identifiziert und verknüpft.`,
              rawOutput: `### Identifizierte Regeln:\n${relRules.length > 0 ? relRules.map((r: any) => `- **${r.type}**: ${r.from}.${r.field} -> ${r.to}`).join('\n') : 'Keine Regeln gefunden.'}\n\n### Protokoll:\n${phase3Logs.join('\n')}`
          };
          await writeChatMessage(migrationId, 'assistant', JSON.stringify(phase3Result), currentStepNumber);
          
          console.log(`[Worker] Phase 3 completed for migration ${migrationId}`);

      } finally {
          await driver.close();
      }

      // Send bundled logs as a single structured message
      const protocolResult = {
          status: "info",
          phase: "Data Ingestion Protocol",
          summary: `Daten-Import und Graph-Strukturierung abgeschlossen: ${totalImported} Objekte geladen.`,
          rawOutput: stagingLogs.join('\n')
      };
      await writeChatMessage(migrationId, 'assistant', JSON.stringify(protocolResult), currentStepNumber);

      result = { 
          status: 'success', 
          message: 'Data Staging erfolgreich abgeschlossen.', 
          stagedCount: totalImported, 
          urls: Array.from(attemptedUrls), 
          logs: stagingLogs,
          phase3Logs: phase3Logs
      };
      await saveStep5Result(migrationId, result);

      const finishClientStaging = await pool.connect();
      try {
        await finishClientStaging.query('BEGIN');
        await finishClientStaging.query('UPDATE migration_steps SET status = $1, result = $2, status_message = $3 WHERE id = $4', [
          'completed', result, 'Data staging completed successfully.', step_id,
        ]);

        const { rows: migRowsStaging } = await finishClientStaging.query('SELECT workflow_state FROM migrations WHERE id = $1', [migrationId]);
        const migrationDataStaging = migRowsStaging[0];
        const { nextState, progress, totalSteps, completedCount } = updateWorkflowForStep(migrationDataStaging?.workflow_state, stepRecord.workflow_step_id || stepId, result, false);
        
        await finishClientStaging.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4, current_step = $5 WHERE id = $6', [
          nextState, progress, 'processing', 'completed', currentStepNumber, migrationId,
        ]);
        await finishClientStaging.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
        
        // KPI: Increment global steps and agent metrics
        await incrementGlobalStats(finishClientStaging, { steps: 1, success: 1, total_agents: 1 });

        await finishClientStaging.query('COMMIT');

        await writeChatMessage(migrationId, 'assistant', 'Die Daten-Bereitstellung (Data Staging) wurde erfolgreich abgeschlossen. Wir können nun mit dem Model Mapping fortfahren.', currentStepNumber);
        
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
        await logActivity(migrationId, 'success', 'Data Staging abgeschlossen.');
      } catch (e) {
        await finishClientStaging.query('ROLLBACK');
        throw e;
      } finally {
        finishClientStaging.release();
      }

    } else if (agentName === 'runMappingVerification') {
      // Step 6: Mapping Verification
      console.log(`[Worker] Running Mapping Verification for migration ${migrationId}`);
      await writeChatMessage(migrationId, 'assistant', 'Verifiziere Mapping-Konfiguration...', currentStepNumber);

      const { rows: migRows6 } = await pool.query('SELECT source_system, target_system FROM migrations WHERE id = $1', [migrationId]);
      const sSys6 = migRows6[0]?.source_system;
      const tSys6 = migRows6[0]?.target_system;

      if (!sSys6 || !tSys6) throw new Error('Systemkonfiguration unvollständig.');

      const { rows: s3Rows6 } = await pool.query('SELECT entity_name, count, is_ignored FROM step_3_results WHERE migration_id = $1', [migrationId]);
      const sEnts6 = s3Rows6.map(r => ({ name: r.entity_name, count: r.count, isIgnored: r.is_ignored }));

      // Fetch Existing Mapping Rules
      const { rows: ruleRows6 } = await pool.query('SELECT * FROM public.mapping_rules WHERE migration_id = $1', [migrationId]);

      const sSpecs6 = await loadObjectScheme(sSys6);
      const tSpecs6 = await loadObjectScheme(tSys6);

      if (!sSpecs6 || !tSpecs6) throw new Error('Objektspezifikationen konnten nicht geladen werden.');

      const messageGenerator = runMappingVerification(sEnts6, ruleRows6, sSpecs6, tSpecs6);
      let lastMessageText: string | undefined;
      for await (const message of messageGenerator) {
        if (message.content && message.content.length > 0 && message.content[0].text) {
          lastMessageText = message.content[0].text;
        }
      }

      if (lastMessageText) {
        try {
          result = JSON.parse(lastMessageText);
          resultMessageText = JSON.stringify(result);
          
          if (result.verification_report && result.verification_report.is_complete === false) {
            isLogicalFailure = true;
            failureMessage = "Mapping ist unvollständig.";
          }
        } catch (e) {
          result = { text: lastMessageText };
          resultMessageText = JSON.stringify(result);
          isLogicalFailure = true;
          failureMessage = "Agent lieferte kein gültiges JSON Ergebnis.";
        }
      } else {
        result = { error: 'Verification agent produced no output' };
        resultMessageText = JSON.stringify(result);
        isLogicalFailure = true;
        failureMessage = "Verification agent produced no output.";
      }

      if (!isLogicalFailure) {
        await saveStep6Result(migrationId, result);
      }

      const finishClient6 = await pool.connect();
      try {
        await finishClient6.query('BEGIN');
        await finishClient6.query('UPDATE migration_steps SET status = $1, result = $2, status_message = $3 WHERE id = $4', [
          isLogicalFailure ? 'failed' : 'completed', result, isLogicalFailure ? failureMessage : 'Mapping verification completed.', step_id,
        ]);

        const { rows: migRowsFinal } = await finishClient6.query('SELECT workflow_state FROM migrations WHERE id = $1', [migrationId]);
        const migDataFinal = migRowsFinal[0];
        const { nextState, progress, totalSteps, completedCount } = updateWorkflowForStep(migDataFinal?.workflow_state, stepRecord.workflow_step_id || stepId, result, isLogicalFailure);
        
        await finishClient6.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4, current_step = $5 WHERE id = $6', [
          nextState, progress, isLogicalFailure ? 'paused' : 'processing', isLogicalFailure ? 'failed' : 'completed', currentStepNumber, migrationId,
        ]);
        await finishClient6.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
        
        // KPI: Increment global stats
        if (!isLogicalFailure) {
          await incrementGlobalStats(finishClient6, { steps: 1, success: 1, total_agents: 1 });
        } else {
          await incrementGlobalStats(finishClient6, { total_agents: 1 });
        }

        await finishClient6.query('COMMIT');

        if (isLogicalFailure) {
          if (result?.verification_report && result.verification_report.is_complete === false) {
            let message = `Die Überprüfung hat ergeben, dass das Mapping noch **unvollständig** ist.\n\n`;
            
            if (result.summary) {
              message += `${result.summary}\n\n`;
            }
            
            if (result.verification_report.missing_entities && result.verification_report.missing_entities.length > 0) {
              message += `**Fehlende Entitäten:** ${result.verification_report.missing_entities.join(', ')}\n`;
            }
            
            if (result.verification_report.target_readiness?.missing_required_fields && result.verification_report.target_readiness.missing_required_fields.length > 0) {
              message += `**Fehlende Pflichtfelder:**\n`;
              result.verification_report.target_readiness.missing_required_fields.forEach((f: any) => {
                message += `- ${f.targetEntity}: ${f.field}\n`;
              });
            }

            message += `\nBitte passen Sie die Regeln im Mapping-Panel an und starten Sie die Verifizierung erneut.`;
            await writeChatMessage(migrationId, 'assistant', message, currentStepNumber);
          } else {
            await writeChatMessage(migrationId, 'assistant', `Schritt 6 Mapping Verification fehlgeschlagen: ${failureMessage}`, currentStepNumber);
          }
          await writeRetryAction(migrationId, currentStepNumber);
          await logActivity(migrationId, 'warning', `Schritt Mapping Verification fehlgeschlagen.`);
        } else {
          // Zuerst die individuelle Zusammenfassung des Agenten
          if (result.summary) {
            await writeChatMessage(migrationId, 'assistant', result.summary, currentStepNumber);
          }
          
          // Dann die standardisierte Erfolgsmeldung
          await writeChatMessage(migrationId, 'assistant', `Schritt 6 **Mapping Verification** erfolgreich abgeschlossen.`, currentStepNumber);
          
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
          await logActivity(migrationId, 'success', 'Mapping Verification erfolgreich abgeschlossen.');
        }
      } catch (e) {
        await finishClient6.query('ROLLBACK');
        throw e;
      } finally {
        finishClient6.release();
      }

    } else if (agentName === 'runMappingRules') {
      const userMessage = agentParams?.userMessage;
      const context = agentParams?.context;

      const messageGenerator = runMappingRules(userMessage, {
          ...context,
          migrationId
      });

      let assistantResponse = "";
      for await (const message of messageGenerator) {
        if (message.content && message.content.length > 0 && message.content[0].text) {
          assistantResponse = message.content[0].text;
        }
      }

      if (assistantResponse) {
        await writeMappingChatMessage(migrationId, 'assistant', assistantResponse);
      }

      await pool.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
      return;

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
      
      // KPI: Increment global stats (only total attempts)
      await incrementGlobalStats(errorClient, { total_agents: 1 });

      await errorClient.query('COMMIT');
      await writeChatMessage(migrationId, 'assistant', `Error: ${errorMessage}`, currentStepNumber);
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

function _extractItems(body: any, entityName: string): any[] {
  if (Array.isArray(body)) return body;
  if (typeof body === 'object' && body !== null) {
      for (const key of [entityName, 'items', 'data', 'tasks', 'results', 'values', 'elements']) {
          if (Array.isArray(body[key])) return body[key];
      }
      for (const key in body) {
          if (Array.isArray(body[key])) return body[key];
      }
  }
  return [];
}

async function _ingestToNeo4j(driver: any, systemLabel: string, entityType: string, items: any[], migrationId: string) {
  const session = driver.session();
  try {
      await session.run(
          `UNWIND $items AS item 
           MERGE (n:\`${systemLabel}\` { external_id: toString(COALESCE(item.id, item.key, item.uuid)), migration_id: $migrationId }) 
           SET n.entity_type = $entityType 
           SET n += item`,
          { 
              items: items.map(i => {
                  const sanitized: any = {};
                  for (const [k, v] of Object.entries(i)) {
                      if (['string', 'number', 'boolean'].includes(typeof v) || v === null) {
                          sanitized[k] = v;
                      } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
                          // Flatten simple nested IDs (e.g., list: { id: "123" } -> list_id: "123")
                          if (v.id) sanitized[`${k}_id`] = String(v.id);
                          // Also keep common name fields if they exist
                          if (v.name) sanitized[`${k}_name`] = String(v.name);
                      }
                  }
                  return sanitized;
              }), 
              migrationId, 
              entityType 
          }
      );
  } finally {
      await session.close();
  }
}

main();