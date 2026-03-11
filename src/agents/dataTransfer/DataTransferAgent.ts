import { AgentBase } from '../core/AgentBase';
import neo4j from 'neo4j-driver';
import { loadScheme } from '../../lib/scheme-loader';
import { resolveOpenAiConfig, buildOpenAiHeaders } from '../openai/openaiClient';
import { runDataTransformation } from '../agentService';

export class DataTransferAgent extends AgentBase {
  async execute(params: any): Promise<any> {
    const { stepNumber, migrationId, dbPool } = this.context;
    
    if (!dbPool) {
        return { success: false, error: "Database pool not provided in context", isLogicalFailure: true };
    }
    
    let result;
    
    // We mock the worker variables/functions to match the context
    const pool = dbPool;
    const currentStepNumber = stepNumber;
    
    const writeChatMessage = async (migId: string, role: string, content: string, stepNum?: number) => {
        return await this.context.writeChatMessage(role, content, stepNum || currentStepNumber);
    };
    
    const upsertChatMessage = async (id: string | null, migId: string, role: string, content: string, stepNum?: number) => {
        if (this.context.upsertChatMessage) {
            return await this.context.upsertChatMessage(id, role, content, stepNum || currentStepNumber);
        }
        return undefined;
    };
    
    const logActivity = async (migId: string, type: any, title: string) => {
       if (this.context.logActivity) await this.context.logActivity(type, title);
    };
    
    const writeRetryAction = async (migId: string, stepNum: number) => {
      const actionContent = JSON.stringify({
        type: "action",
        actions: [
          {
            action: "retry",
            label: `Schritt ${stepNum} wiederholen`,
            variant: "outline",
            stepNumber: stepNum
          }
        ]
      });
      await writeChatMessage(migId, 'system', actionContent, stepNum);
    };
    
    let isLogicalFailure = false;
    let failureMessage = "";
    
    // Some worker variables that we don't need but they are referenced
    const step_id = params?.stepId || null;
    const job = { id: params?.jobId || '00000000-0000-0000-0000-000000000000' };
    const stepRecord = params?.stepRecord || {};
    
    // We shouldn't actually do the final state commit inside the agent, but to keep the code unchanged:
    const updateWorkflowForStep = (state: any, id: string, res: any, err: boolean) => { return { nextState: state, progress: 0 }; };
    const incrementGlobalStats = async (...args: any[]) => {};
    const AGENT_WORKFLOW_STEPS: any[] = [];
    const agentParams = params;
    
    
    // Start processing the data transfer
    console.log(`[Worker] Running Data Transfer for migration ${migrationId}`);
      
      // Phase 0: Target Container Preparation & Planning
      const { rows: migRowsScope } = await dbPool.query('SELECT name, source_system, target_system, scope_config, context FROM migrations WHERE id = $1', [migrationId]);
      const migrationName = migRowsScope[0]?.name;
      const sourceSystem = migRowsScope[0]?.source_system;
      const targetSystem = migRowsScope[0]?.target_system;
      const scopeConfig = migRowsScope[0]?.scope_config || {};
      const migrationContext = migRowsScope[0]?.context || {};
      
      const sourceScopeName = scopeConfig.sourceScope;
      const preferredTargetName = (scopeConfig.targetName && scopeConfig.targetName !== "-") 
        ? scopeConfig.targetName 
        : (sourceScopeName || migrationName || "New Migration Project");

      // --- ALWAYS RESET ATTEMPTS FOR NODES WITHOUT TARGET_ID ---
      const driverReset = neo4j.driver(
        process.env.NEO4J_URI || "bolt://neo4j-db:7687",
        neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "password")
      );
      const sessionReset = driverReset.session();
      try {
          await sessionReset.run(
              `MATCH (n) WHERE n.migration_id = $migrationId AND n.target_id IS NULL 
               SET n.transfer_attempts = null, n.transfer_error = null`,
              { migrationId }
          );
          console.log(`[Worker] Reset transfer attempts for migration ${migrationId}`);
      } catch (err) {
          console.error(`[Worker] Failed to reset attempts:`, err);
      } finally {
          await sessionReset.close();
          await driverReset.close();
      }

      // --- PLANNING PHASE ---
      if (!scopeConfig.transferPlanApproved) {
          await writeChatMessage(migrationId, 'assistant', `Erstelle Migrations-Plan für den Transfer zu **${targetSystem}**...`, currentStepNumber);
          
          const driver = neo4j.driver(
            process.env.NEO4J_URI || "bolt://neo4j-db:7687",
            neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "password")
          );
          
          let stats = "";
          const session = driver.session();
          try {
              const res = await session.run(
                  `MATCH (n) WHERE n.migration_id = $migrationId 
                   RETURN n.entity_type as type, count(n) as count`,
                  { migrationId }
              );
              stats = res.records.map(r => `- **${r.get('type')}**: ${r.get('count')} Objekte`).join('\n');
          } finally {
              await session.close();
              await driver.close();
          }

          const { rows: ruleRows } = await dbPool.query('SELECT source_object, target_object, rule_type FROM mapping_rules WHERE migration_id = $1 AND rule_type != \'IGNORE\'', [migrationId]);
          const mappingSummary = ruleRows.map(r => `- ${r.source_object} → ${r.target_object} (${r.rule_type})`).join('\n');
          
          const targetScheme = await loadScheme(targetSystem);
          const { apiKey, baseUrl, projectId: openAiProjectId } = await resolveOpenAiConfig();
          const openAiHeaders = buildOpenAiHeaders(apiKey, openAiProjectId);

          const planPrompt = `
Du bist ein Migrations-Experte. Erstelle einen finalen Transfer-Plan für den Nutzer.
System: ${sourceSystem} nach ${targetSystem}.

### MIGRATIONS-GEDÄCHTNIS:
${JSON.stringify(migrationContext, null, 2)}

### DATEN-STATISTIK:
${stats}

### MAPPING-ZUSAMMENFASSUNG:
${mappingSummary}

### ZIEL-STRUKTUR (Export Logik):
${targetScheme?.exportInstructions?.logic || "Standard-Hierarchie"}

### AUFGABE:
Fasse zusammen, wie die Migration ablaufen wird. 
1. Welche Container werden im Ziel erstellt? (Basierend auf Name: "${preferredTargetName}")
2. In welcher Reihenfolge werden die Objekte übertragen?
3. Gibt es Besonderheiten?

Antworte prägnant und strukturiert in Markdown.
          `;

          try {
              const planRes = await this.provider.chat([{ role: "system", content: planPrompt }], undefined, {
                  model: "gpt-4o"
              });
              
              const planContent = planRes.content;
              
              if (planContent) {
                  await writeChatMessage(migrationId, 'assistant', `### 📋 Migrations-Plan\n\n${planContent}`, currentStepNumber);
                  
                  const actionContent = JSON.stringify({
                      type: "action",
                      actions: [
                        { action: "confirm_transfer_plan", label: "Plan bestätigen & Transfer starten", variant: "primary" },
                        { action: "retry", label: "Plan neu generieren", variant: "outline", stepNumber: currentStepNumber },
                        { action: "reset_and_retry_transfer", label: "Alles zurücksetzen & von vorne starten", variant: "destructive" }
                      ]
                  });
                  await writeChatMessage(migrationId, 'system', actionContent, currentStepNumber);
                  
                  // WICHTIG: Status der Migration auf 'completed' setzen, damit die UI die Buttons anzeigt
                  await dbPool.query('UPDATE migrations SET step_status = $1, status = $2 WHERE id = $3', ['completed', 'processing', migrationId]);
                  await dbPool.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
                  return {
                      success: true,
                      isEarlyReturnForPlan: true,
                      result: { status: 'planning_sent', plan: planContent },
                      isLogicalFailure: false
                  };
              }
          } catch (err) {
              console.error("[Worker] Error generating plan:", err);
          }
      }

      // --- EXECUTION PHASE (only if approved) ---
      
      const { rows: step4Rows } = await dbPool.query('SELECT target_scope_id FROM step_4_results WHERE migration_id = $1', [migrationId]);
      let targetScopeId = step4Rows[0]?.target_scope_id;

      // VERIFICATION: Check if target container still exists
      if (targetScopeId) {
          const { rows: targetConnectorRows } = await dbPool.query('SELECT api_url, api_key, username, auth_type FROM connectors WHERE migration_id = $1 AND connector_type = $2', [migrationId, 'out']);
          const targetConnector = targetConnectorRows[0];
          const targetScheme = await loadScheme(targetSystem);
          
          if (targetConnector && targetScheme) {
              const { apiKey, baseUrl, projectId: openAiProjectId } = await resolveOpenAiConfig();
              const openAiHeaders = buildOpenAiHeaders(apiKey, openAiProjectId);
              const targetContainerType = scopeConfig.targetContainerType || targetScheme.exportInstructions?.preferredContainerType || "project";

              const verifyPrompt = `
Du bist ein Cloud-Integrations-Experte. Erstelle den API-Call, um die Existenz eines Haupt-Containers (ID: ${targetScopeId}) im System **${targetSystem}** zu prüfen.

### ZIEL-SYSTEM INFOS:
${JSON.stringify(targetScheme, null, 2)}

### ZIEL-CONNECTOR URL:
${targetConnector.api_url}

### AUFGABE:
Prüfe ob der Container vom Typ **"${targetContainerType}"** mit der ID **"${targetScopeId}"** existiert.
Nutze einen GET Request auf den entsprechenden Detail-Endpunkt.

ANTWORTE AUSSCHLIESSLICH IM JSON FORMAT:
{
  "url": "string", // Relativ zur Base-URL oder absolut
  "method": "GET"
}
              `;

              try {
                  const verifyRes = await this.provider.chat([{ role: "system", content: verifyPrompt }], undefined, {
                      model: "gpt-4o",
                      response_format: { type: "json_object" }
                  });

                  const callConfig = JSON.parse(verifyRes.content || "{}");

                  const targetHeaders: any = { 
                      "Accept": "application/json",
                      "Content-Type": "application/json",
                      ...(targetScheme.headers || {})
                  };

                  if (targetConnector.auth_type === 'api_key' && targetConnector.api_key) {
                      const authConf = targetScheme.authentication;
                      const prefix = authConf?.tokenPrefix !== undefined ? authConf.tokenPrefix : 'Bearer ';
                      const headerName = authConf?.headerName || 'Authorization';
                      targetHeaders[headerName] = `${prefix}${targetConnector.api_key}`;
                  }

                  const finalUrl = callConfig.url.startsWith('http') ? callConfig.url : (targetScheme.apiBaseUrl || "") + callConfig.url;
                  const apiRes = await fetch(finalUrl, {
                      method: callConfig.method,
                      headers: targetHeaders
                  });

                  if (apiRes.status === 404) {
                      console.log(`[Worker] Target container ${targetScopeId} not found (404). Will recreate.`);
                      await writeChatMessage(migrationId, 'assistant', `Der zuvor erstellte Ziel-Container (ID: ${targetScopeId}) wurde nicht mehr im Zielsystem gefunden. Ich setze den Transfer-Status zurück und lege den Container neu an...`, currentStepNumber);

                      // Reset database
                      await dbPool.query('DELETE FROM step_4_results WHERE migration_id = $1', [migrationId]);

                      // Reset Neo4j
                      const driver = neo4j.driver(
                        process.env.NEO4J_URI || "bolt://neo4j-db:7687",
                        neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "password")
                      );
                      const session = driver.session();
                      try {
                          await session.run(
                              `MATCH (n) WHERE n.migration_id = $migrationId 
                               SET n.target_id = null, n.transfer_attempts = null, n.transfer_error = null`,
                              { migrationId }
                          );
                          console.log(`[Worker] Neo4j target_ids cleared for migration ${migrationId}`);
                      } catch (neoErr) {
                          console.error(`[Worker] Failed to clear Neo4j target_ids:`, neoErr);
                      } finally {
                          await session.close();
                          await driver.close();
                      }

                      targetScopeId = null;
                  } else if (!apiRes.ok) {
                      console.log(`[Worker] Verification check failed with status ${apiRes.status}. Proceeding assuming it might exist.`);
                  } else {
                      console.log(`[Worker] Target container ${targetScopeId} verified.`);
                  }
              } catch (err) {
                  console.error(`[Worker] Error in existence verification:`, err);
              }

          }
      }

      if (!targetScopeId) {
          await writeChatMessage(migrationId, 'assistant', `Phase 0: Bereite Ziel-Container in **${targetSystem}** vor...`, currentStepNumber);
          
          const { rows: targetConnectorRows } = await dbPool.query('SELECT api_url, api_key, username, auth_type FROM connectors WHERE migration_id = $1 AND connector_type = $2', [migrationId, 'out']);
          const targetConnector = targetConnectorRows[0];
          const targetScheme = await loadScheme(targetSystem);
          
          if (targetConnector && targetScheme) {
              const { apiKey, baseUrl, projectId: openAiProjectId } = await resolveOpenAiConfig();
              const openAiHeaders = buildOpenAiHeaders(apiKey, openAiProjectId);
              
              // Bestimme Container-Typ (Nutzerwahl oder System-Standard)
              const targetContainerType = scopeConfig.targetContainerType || targetScheme.exportInstructions?.preferredContainerType || "project";

              const containerPrompt = `
Du bist ein Cloud-Integrations-Experte. Erstelle den API-Call, um einen neuen Haupt-Container im System **${targetSystem}** zu erstellen.

### ZIEL-SYSTEM INFOS:
${JSON.stringify(targetScheme, null, 2)}

### ZIEL-CONNECTOR URL (enthält ggf. IDs wie Team-ID):
${targetConnector.api_url}

### AUFGABE:
Erstelle einen Container vom Typ **"${targetContainerType}"** mit dem Namen: **"${preferredTargetName}"**.
WICHTIG: Falls du eine Team-ID oder Workspace-ID aus der Connector-URL extrahieren kannst, nutze diese für den API-Call (z.B. in der URL).

ANTWORTE AUSSCHLIESSLICH IM JSON FORMAT:
{
  "url": "string", // Relativ zur Base-URL oder absolut
  "method": "POST",
  "body": { ... }
}
              `;

              try {
                  const containerRes = await this.provider.chat([{ role: "system", content: containerPrompt }], undefined, {
                      model: "gpt-4o",
                      response_format: { type: "json_object" }
                  });
                  
                  const callConfig = JSON.parse(containerRes.content || "{}");
                      
                  const targetHeaders: any = { 
                      "Accept": "application/json",
                      "Content-Type": "application/json",
                      ...(targetScheme.headers || {})
                  };

                      if (targetConnector.auth_type === 'api_key' && targetConnector.api_key) {
                          const authConf = targetScheme.authentication;
                          const prefix = authConf?.tokenPrefix !== undefined ? authConf.tokenPrefix : 'Bearer ';
                          const headerName = authConf?.headerName || 'Authorization';
                          targetHeaders[headerName] = `${prefix}${targetConnector.api_key}`;
                      }

                      const finalUrl = callConfig.url.startsWith('http') ? callConfig.url : (targetScheme.apiBaseUrl || "") + callConfig.url;
                      const apiRes = await fetch(finalUrl, {
                          method: callConfig.method,
                          headers: targetHeaders,
                          body: JSON.stringify(callConfig.body)
                      });

                      if (apiRes.ok) {
                          const apiData = await apiRes.json();
                          // Try to find ID in common places
                          const newTargetId = apiData.id || apiData.gid || apiData.key || (apiData.data?.id) || (apiData.data?.gid);
                          
                          if (newTargetId) {
                              targetScopeId = String(newTargetId);
                              await dbPool.query(
                                  `INSERT INTO public.step_4_results (migration_id, target_scope_id, target_scope_name, target_status)
                                   VALUES ($1, $2, $3, 'ready')
                                   ON CONFLICT (migration_id) DO UPDATE SET
                                     target_scope_id = EXCLUDED.target_scope_id,
                                     target_scope_name = EXCLUDED.target_scope_name,
                                     target_status = EXCLUDED.target_status`,
                                  [migrationId, targetScopeId, preferredTargetName]
                              );
                              await writeChatMessage(migrationId, 'assistant', `Ziel-Container **"${preferredTargetName}"** (${targetContainerType}) erfolgreich erstellt (ID: ${targetScopeId}).`, currentStepNumber);
                          }
                      } else {
                          const errText = await apiRes.text();
                          console.error(`[Worker] Container creation failed: ${errText}`);
                          await writeChatMessage(migrationId, 'assistant', `⚠️ Konnte Container nicht automatisch erstellen. Nutze Standard-Scope.`, currentStepNumber);
                      }
              } catch (err) {
                  console.error(`[Worker] Error in Phase 0:`, err);
              }
          }
      }

      await writeChatMessage(migrationId, 'assistant', 'Phase 1: Datenveredelung in Neo4j...', currentStepNumber);

      // 1. Fetch migration details (already done above, but keeping structure for minimal changes)
      let rateLimitResult = { delay: 1.0, batch_size: 50 };

      // 2. Fetch rules with enhancements OR special types (POLISH, ENHANCE)
      const { rows: ruleRows8 } = await dbPool.query(
        `SELECT * FROM mapping_rules 
         WHERE migration_id = $1 
         AND (
           (enhancements IS NOT NULL AND jsonb_array_length(enhancements) > 0) 
           OR rule_type = 'POLISH' 
           OR rule_type = 'ENHANCE'
         )`, 
        [migrationId]
      );

      if (ruleRows8.length > 0) {
        const driver = neo4j.driver(
          process.env.NEO4J_URI || "bolt://neo4j-db:7687",
          neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "password")
        );

        try {
          // Group rules by source_object
          const rulesByEntity: Record<string, Record<string, string[]>> = {};
          for (const rule of ruleRows8) {
            if (!rulesByEntity[rule.source_object]) rulesByEntity[rule.source_object] = {};
            
            const enhancements = Array.isArray(rule.enhancements) ? [...rule.enhancements] : [];
            // If it's a POLISH or ENHANCE rule with a note, add the note as an instruction
            if ((rule.rule_type === 'POLISH' || rule.rule_type === 'ENHANCE') && rule.note) {
              enhancements.push(`INSTRUCTION: ${rule.note}`);
            }
            
            if (enhancements.length > 0) {
              rulesByEntity[rule.source_object][rule.source_property] = enhancements;
            }
          }

          // 1. INITIALIZATION: Set _enhanced = false for all nodes that NEED enhancement
          const initSession = driver.session();
          try {
            for (const entityType of Object.keys(rulesByEntity)) {
              await initSession.run(
                `MATCH (n:\`${sourceSystem}\`) 
                 WHERE n.migration_id = $migrationId 
                 AND (n.entity_type = $entityType OR n.entity_type = $entityType + "s" OR n.entity_type = $entityType + "es")
                 SET n._enhanced = false`,
                { migrationId, entityType }
              );
            }
            console.log(`[Worker] Initialization complete: All target nodes marked with _enhanced = false`);
          } finally {
            await initSession.close();
          }

          // 2. PROCESSING: Loop until no more _enhanced = false nodes exist
          for (const [entityType, config] of Object.entries(rulesByEntity)) {
            await writeChatMessage(migrationId, 'assistant', `Veredele Entität: **${entityType}**...`, currentStepNumber);
            
            let processedInEntity = 0;
            while (true) {
              const session = driver.session();
              try {
                // Fetch ONLY nodes that are explicitly set to false
                const nodeRes = await session.run(
                  `MATCH (n:\`${sourceSystem}\`) 
                   WHERE n.migration_id = $migrationId 
                   AND (n.entity_type = $entityType OR n.entity_type = $entityType + "s" OR n.entity_type = $entityType + "es")
                   AND n._enhanced = false
                   RETURN n LIMIT 25`, 
                  { migrationId, entityType }
                );

                const nodes = nodeRes.records.map(r => r.get('n').properties);
                if (nodes.length === 0) break; 

                const BATCH_SIZE = 5; 
                for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
                  const batch = nodes.slice(i, i + BATCH_SIZE);
                  
                  // Create granular transformation tasks
                  const tasks: any[] = [];
                  for (const node of batch) {
                    for (const [field, instructions] of Object.entries(config)) {
                      if (node[field] !== undefined) {
                        tasks.push({
                          id: node.external_id,
                          field: field,
                          value: node[field],
                          instruction: instructions.join(', ')
                        });
                      }
                    }
                  }

                  if (tasks.length === 0) {
                      await session.run(
                        `UNWIND $ids AS id
                         MATCH (n:\`${sourceSystem}\` { migration_id: $migrationId, external_id: toString(id) })
                         SET n._enhanced = true`,
                        { ids: batch.map(b => b.external_id), migrationId }
                      );
                      continue;
                  }

                  const updates = await runDataTransformation(tasks);
                  
                  // Apply surgical updates to Neo4j
                  if (updates.length > 0) {
                    await session.run(
                      `UNWIND $updates AS update
                       MATCH (n:\`${sourceSystem}\` { migration_id: $migrationId, external_id: toString(update.id) })
                       SET n[update.field] = update.newValue`,
                      { updates, migrationId }
                    );
                  }

                  // Always mark nodes as enhanced to avoid infinite loops
                  await session.run(
                    `UNWIND $ids AS id
                     MATCH (n:\`${sourceSystem}\` { migration_id: $migrationId, external_id: toString(id) })
                     SET n._enhanced = true`,
                    { ids: batch.map(b => b.external_id), migrationId }
                  );
                  
                  processedInEntity += batch.length;
                  console.log(`[Worker] Entity: ${entityType}, Processed batch of ${batch.length}. Total: ${processedInEntity}`);
                  
                  // Periodic progress update in chat
                  if (processedInEntity % 10 === 0 || processedInEntity % 10 < batch.length) {
                      await writeChatMessage(migrationId, 'assistant', `Fortschritt ${entityType}: **${processedInEntity}** Objekte veredelt...`, currentStepNumber);
                  }
                  
                  await new Promise(resolve => setTimeout(resolve, 500));
                }
              } finally {
                await session.close();
              }
            }
          }
          await writeChatMessage(migrationId, 'assistant', 'Datenveredelung in Neo4j erfolgreich abgeschlossen.', currentStepNumber);
        } finally {
          await driver.close();
        }
      } else {
        await writeChatMessage(migrationId, 'assistant', 'Keine Qualitäts-Enhancements konfiguriert. Überspringe Phase 1.', currentStepNumber);
      }

      // Phase 2: Agent-Driven Data Transfer
      await writeChatMessage(migrationId, 'assistant', 'Phase 2: Transfer der veredelten Daten in das Zielsystem startet...', currentStepNumber);
      
      const targetScheme = await loadScheme(targetSystem);
      const { rows: targetConnectorRows } = await dbPool.query('SELECT api_url, api_key, username, auth_type FROM connectors WHERE migration_id = $1 AND connector_type = $2', [migrationId, 'out']);
      const targetConnector = targetConnectorRows[0];
      const exportSeq = targetScheme?.exportInstructions?.sequence || [];
      const exportLogic = targetScheme?.exportInstructions?.logic || "Transfer data using provided mappings and endpoints.";

      console.log(`[Worker] Using targetScopeId for migration: ${targetScopeId}`);

      if (exportSeq.length === 0) {
          await writeChatMessage(migrationId, 'assistant', '⚠️ Keine Export-Sequenz im Zielschema definiert. Transfer abgebrochen.', currentStepNumber);
          throw new Error("Missing export sequence in target scheme.");
      }

      if (!targetConnector) {
          throw new Error("Target connector credentials not found.");
      }

      const driver = neo4j.driver(
        process.env.NEO4J_URI || "bolt://neo4j-db:7687",
        neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "password")
      );

      try {
          // 1. Calculate total nodes to transfer for progress bar
          const countSession = driver.session();
          let totalNodesToTransfer = 0;
          try {
              const countRes = await countSession.run(
                  `MATCH (n:\`${sourceSystem}\`) 
                   WHERE n.migration_id = $migrationId 
                   AND n.target_id IS NULL
                   RETURN count(n) as total`,
                  { migrationId }
              );
              totalNodesToTransfer = countRes.records[0].get('total').toNumber();
              console.log(`[DataTransferAgent] Calculated ${totalNodesToTransfer} unique nodes to transfer from Neo4j.`);
          } finally {
              await countSession.close();
          }

          let totalTransferred = 0;
          let transferErrors = 0;
          
          // Create initial live status message
          let liveStatusId = await writeChatMessage(migrationId, 'assistant', JSON.stringify({
              type: 'live-transfer-status',
              total: totalNodesToTransfer,
              processed: 0,
              successCount: 0,
              errorCount: 0,
              currentEntity: 'Vorbereitung',
              status: 'running'
          }), currentStepNumber);

          const { rows: ruleRows8 } = await dbPool.query('SELECT * FROM public.mapping_rules WHERE migration_id = $1', [migrationId]);

          // Process entities in sequence
          for (const targetEntityType of exportSeq) {
              // Find source objects that map to this target type
              const { rows: entityRules } = await dbPool.query(
                  "SELECT DISTINCT source_object FROM mapping_rules WHERE migration_id = $1 AND target_object = $2 AND rule_type != 'IGNORE'",
                  [migrationId, targetEntityType]
              );
              
              const sourceObjectTypes = entityRules.map(r => r.source_object);
              if (sourceObjectTypes.length === 0) {
                  console.log(`[Worker] No source objects map to target type ${targetEntityType}. Skipping.`);
                  continue;
              }

              for (const sourceObjectType of sourceObjectTypes) {
                  let processedInBatch = 0;
                  
                  // --- FETCH SAMPLE NODE FOR BETTER PROMPTING ---
                  let sampleNode: any = null;
                  const sampleSession = driver.session();
                  try {
                      const sampleRes = await sampleSession.run(
                          `MATCH (n:\`${sourceSystem}\`) 
                           WHERE n.migration_id = $migrationId 
                           AND (toLower(n.entity_type) = toLower($sourceObjectType) OR toLower(n.entity_type) = toLower($sourceObjectType) + "s")
                           RETURN properties(n) as props LIMIT 1`,
                          { migrationId, sourceObjectType }
                      );
                      if (sampleRes.records.length > 0) {
                          sampleNode = sampleRes.records[0].get('props');
                      }
                  } finally {
                      await sampleSession.close();
                  }

                  // Update live status for current entity
                  await upsertChatMessage(liveStatusId, migrationId, 'assistant', JSON.stringify({
                      type: 'live-transfer-status',
                      total: totalNodesToTransfer,
                      processed: totalTransferred + transferErrors,
                      successCount: totalTransferred,
                      errorCount: transferErrors,
                      currentEntity: `Initialisiere ${sourceObjectType}...`,
                      status: 'running'
                  }), currentStepNumber);
                  
                  // 1. GENERATE RECIPE ONCE PER ENTITY PAIR
                  const { apiKey, baseUrl, projectId: openAiProjectId } = await resolveOpenAiConfig();
                  const openAiHeaders = buildOpenAiHeaders(apiKey, openAiProjectId);

                  const entityMappingRules = ruleRows8.filter(r => 
                      (r.source_object === sourceObjectType) && 
                      r.target_object === targetEntityType
                  );

                  const recipePrompt = `
Du bist ein technischer Architekt. Erstelle ein Transfer-Rezept (Template) für die Migration von ${sourceObjectType} zu ${targetEntityType} im System ${targetSystem}.

### ZIEL-LOGIK:
${exportLogic}

### MAPPING-REGELN:
${JSON.stringify(entityMappingRules, null, 2)}

### BEISPIEL-DATEN (Quelle - nutze NUR diese Felder für Platzhalter):
${sampleNode ? JSON.stringify(sampleNode, null, 2) : "Keine Beispieldaten verfügbar."}

### ZIEL-ENDPUNKTE:
${JSON.stringify(targetScheme?.discovery?.endpoints || {}, null, 2)}

### ZIEL-SCOPE (Haupt-Container):
ID: ${targetScopeId || 'Nicht definiert'}

### ZIEL-CONNECTOR URL (enthält ggf. Team/Workspace-IDs):
${targetConnector.api_url}

### AUFGABE:
Erstelle ein JSON-Rezept, das beschreibt, wie ein API-Call für ein einzelnes Objekt aufgebaut wird. 
WICHTIG: Halte dich STRIKT an die API-Struktur von ${targetSystem}. 

Nutze folgende Platzhalter-Syntax:
- \${property_name}: Wert einer Eigenschaft des Quell-Objekts (z.B. \${name}, \${notes}). Nutze NUR Felder aus den BEISPIEL-DATEN.
- \${parent:RELATIONSHIP_TYPE:target_id}: Die im Zielsystem bereits existierende ID eines Parent-Objekts, das über RELATIONSHIP_TYPE verknüpft ist.
- \${GLOBAL_ROOT_ID}: Die ID des Ziel-Containers (ID: ${targetScopeId}), falls kein spezifisches Parent-Objekt gefunden wird.
- \${TEAM_ID} / \${WORKSPACE_ID}: Eine aus der ZIEL-CONNECTOR URL extrahierte globale ID (z.B. ClickUp Team-ID).

### REGELN FÜR DIE STRUKTUR:
1. **NAMEN:** Das Feld "name" (oder äquivalent) im Ziel DARF NIEMALS leer sein. Nutze \${name} oder einen statischen Fallback.
2. **DATENTYPEN:** Felder wie "description" oder "content" müssen Strings sein. Erzeuge KEINE verschachtelten Objekte für diese Felder.
3. **IDS:** Nutze für URLs und Body-Felder, die eine ID erwarten, ENTWEDER einen Platzhalter (wie \${GLOBAL_ROOT_ID}, \${TEAM_ID}) ODER extrahiere eine statische ID aus der ZIEL-CONNECTOR URL.
4. **UNTERSCHEIDUNG:** Beachte, dass \${GLOBAL_ROOT_ID} die ID des in Phase 0 erstellten Containers ist (z.B. ein Space). \${TEAM_ID} ist die übergeordnete Workspace-Ebene.
5. **VERBOT:** Nutze NIEMALS Platzhalter wie "---", "0", "null" oder "undefined" für ID-Felder. Falls du keine ID hast, nutze \${GLOBAL_ROOT_ID} als Fallback oder lasse das Feld weg, falls optional.

${targetSystem === 'Notion' ? `
WICHTIG FÜR NOTION:
- Pages benötigen ein "parent" Objekt.
- DAS FELD "id" EXISTIERT NICHT IN "parent". NUTZE ZWINGEND "page_id" ODER "database_id".
- Nutze \${GLOBAL_ROOT_ID} als Fallback für die Parent-ID: {"parent": {"page_id": "\${GLOBAL_ROOT_ID}"}}
- In "properties" ist bei Pages NUR der "title" erlaubt: {"title": {"title": [{"text": {"content": "\${name}"}}]}}
- JEDER WEITERE INHALT (wie eine Description) muss in das "children" Array als Block-Objekt.
- WICHTIG: Der "content" String darf NIEMALS leer oder null sein. Falls ein Feld leer ist, nutze einen Fallback-String wie "---" oder "Keine Information".
- Beispiel für Description als Paragraph-Block: 
  "children": [{
    "object": "block",
    "type": "paragraph",
    "paragraph": { "rich_text": [{ "type": "text", "text": { "content": "\${description}" } }] }
  }]
- Notion API Version: 2022-06-28
` : ''}

ANTWORTE AUSSCHLIESSLICH IM JSON FORMAT:
{
  "urlTemplate": "string",
  "method": "POST" | "PATCH",
  "bodyTemplate": {
     "key": "value",
     ...
  }
}
                  `;

                  let recipe: any = null;
                  try {
                      const recipeRes = await fetch(`${baseUrl}/chat/completions`, {
                          method: 'POST',
                          headers: openAiHeaders,
                          body: JSON.stringify({
                              model: "gpt-4o-mini", // Use mini for recipe generation to save even more
                              messages: [{ role: "system", content: recipePrompt }],
                              response_format: { type: "json_object" }
                          })
                      });
                      if (!recipeRes.ok) throw new Error("Failed to generate recipe");
                      const recipeData = await recipeRes.json();
                      recipe = JSON.parse(recipeData.choices[0].message.content);
                      console.log(`[Worker] Generated recipe for ${sourceObjectType} -> ${targetEntityType}:`, JSON.stringify(recipe));
                  } catch (err) {
                      console.error(`[Worker] Failed to generate transfer recipe:`, err);
                      await writeChatMessage(migrationId, 'assistant', `⚠️ Fehler bei der Rezept-Erstellung für ${sourceObjectType}. Nutze Einzel-Agenten Modus...`, currentStepNumber);
                  }

                  // 2. EXECUTE PROGRAMMATICALLY USING RECIPE
                  console.log(`[Worker] Starting transfer loop for ${sourceObjectType} -> ${targetEntityType}`);
                  while (true) {
                      const session = driver.session();
                      try {
                          // Fetch nodes that haven't been transferred yet (target_id is NULL) and haven't exceeded retry limit
                          const nodeRes = await session.run(
                              `MATCH (n:\`${sourceSystem}\`) 
                               WHERE n.migration_id = $migrationId 
                               AND (
                                 toLower(n.entity_type) = toLower($sourceObjectType) OR 
                                 toLower(n.entity_type) = toLower($sourceObjectType) + "s" OR 
                                 toLower(n.entity_type) = toLower($sourceObjectType) + "es" OR
                                 toLower(n.entity_type) CONTAINS toLower($sourceObjectType)
                               )
                               AND n.target_id IS NULL
                               AND (n.transfer_attempts IS NULL OR n.transfer_attempts < 3)
                               OPTIONAL MATCH (n)-[r]->(p) 
                               WHERE p.target_id IS NOT NULL
                               RETURN n, collect({ type: type(r), target_id: p.target_id, entity_type: p.entity_type }) as parents
                               LIMIT 20`, 
                              { migrationId, sourceObjectType }
                          );

                          const records = nodeRes.records;
                          console.log(`[Worker] Found ${records.length} nodes to transfer for ${sourceObjectType}`);
                          if (records.length === 0) break;

                          for (const record of records) {
                              const node = record.get('n').properties;
                              const parents = record.get('parents') as any[];
                              
                              let callConfig: any;

                              if (recipe) {
                                  // APPLY RECIPE PROGRAMMATICALLY
                                  try {
                                      // Extract potential global IDs from connector URL (e.g. ClickUp Team ID)
                                      const connectorUrl = targetConnector.api_url || "";
                                      const urlIds = connectorUrl.match(/\d{5,}/g) || [];
                                      const teamIdFromUrl = urlIds[0] || "";

                                      const resolveValue = (val: string): any => {
                                          if (typeof val !== 'string') return val;
                                          
                                          // Global Root fallback
                                          if (val === '${GLOBAL_ROOT_ID}') return targetScopeId;
                                          if (val === '${TEAM_ID}' || val === '${WORKSPACE_ID}') return teamIdFromUrl;

                                          // Parent lookup: ${parent:TYPE:target_id}
                                          if (val.startsWith('${parent:')) {
                                              const match = val.match(/\${parent:([^:]+):([^}]+)}/);
                                              if (match) {
                                                  const relType = match[1];
                                                  const prop = match[2];
                                                  // Fuzzy match relationship type
                                                  const parent = parents.find(p => p.type && (p.type === relType || p.type.startsWith(relType) || relType.startsWith(p.type)));
                                                  const res = parent ? parent[prop] : null;
                                                  
                                                  if (!res) {
                                                      console.log(`[Worker] Could not resolve parent ${val} for node ${node.external_id}. Fallback to root.`);
                                                      return targetScopeId;
                                                  }
                                                  return res;
                                              }
                                          }
                                          
                                          // Property lookup: ${prop}
                                          if (val.startsWith('${') && val.endsWith('}')) {
                                              const propName = val.slice(2, -1);
                                              if (propName === 'GLOBAL_ROOT_ID') return targetScopeId;
                                              if (propName === 'TEAM_ID' || propName === 'WORKSPACE_ID') return teamIdFromUrl;
                                              const nodeVal = node[propName];
                                              return (nodeVal !== undefined && nodeVal !== null) ? nodeVal : null; 
                                          }
                                          
                                          // Inline string replacement
                                          return val.replace(/\${([^}]+)}/g, (_, propName) => {
                                              if (propName === 'GLOBAL_ROOT_ID') return targetScopeId || '';
                                              if (propName === 'TEAM_ID' || propName === 'WORKSPACE_ID') return teamIdFromUrl;
                                              if (propName.startsWith('parent:')) {
                                                  const parts = propName.split(':');
                                                  const parent = parents.find(p => p.type && (p.type === parts[1] || p.type.startsWith(parts[1])));
                                                  return parent ? parent[parts[2]] : (targetScopeId || '');
                                              }
                                              const nodeVal = node[propName];
                                              return (nodeVal !== undefined && nodeVal !== null) ? String(nodeVal) : "";
                                          });
                                      };

                                      const processObject = (obj: any): any => {
                                          if (Array.isArray(obj)) return obj.map(processObject);
                                          if (obj !== null && typeof obj === 'object') {
                                              const result: any = {};
                                              for (const [k, v] of Object.entries(obj)) {
                                                  result[k] = processObject(v);
                                              }
                                              return result;
                                          }
                                          return resolveValue(obj);
                                      };

                                      const resolvedUrl = resolveValue(recipe.urlTemplate);
                                      if (!resolvedUrl) throw new Error("URL template resolved to empty/null");

                                      callConfig = {
                                          url: resolvedUrl,
                                          method: recipe.method || 'POST',
                                          body: processObject(recipe.bodyTemplate)
                                      };
                                  } catch (recipeErr) {
                                      console.error(`[Worker] Error applying recipe to ${node.external_id}:`, recipeErr);
                                      // UPDATE NEO4J SO WE DON'T LOOP INFINITELY
                                      await session.run(
                                          `MATCH (n:\`${sourceSystem}\` { migration_id: $migrationId, external_id: $extId }) 
                                           SET n.transfer_attempts = coalesce(n.transfer_attempts, 0) + 1, 
                                               n.transfer_error = $errText`,
                                          { migrationId, extId: String(node.external_id), errText: `Recipe Error: ${String(recipeErr).substring(0, 100)}` }
                                      );
                                      transferErrors++;
                                      continue;
                                  }
                              } else {
                                  // FALLBACK: AGENT-DRIVEN FOR SINGLE OBJECT
                                  const agentPrompt = `
Du bist ein Data Export Agent. Erstelle den exakten API-Call für dieses Objekt im System ${targetSystem}.

### ZIEL-LOGIK:
${exportLogic}

### MAPPING-REGELN:
${JSON.stringify(entityMappingRules, null, 2)}

### ZIEL-ENDPUNKTE:
${JSON.stringify(targetScheme?.discovery?.endpoints || {}, null, 2)}

### ZIEL-SCOPE (Haupt-Container):
ID: ${targetScopeId || 'Nicht definiert'}

### OBJEKT-DATEN (Quelle):
${JSON.stringify(node)}

### VERKNÜPFTE PARENTS (Ziel-IDs):
${JSON.stringify(parents)}

ANTWORTE AUSSCHLIESSLICH IM JSON FORMAT:
{
  "url": "string",
  "method": "POST" | "PATCH",
  "body": { ... }
}
                                  `;

                                  try {
                                      const agentRes = await this.provider.chat([{ role: "system", content: agentPrompt }], undefined, {
                                          model: "gpt-4o-mini",
                                          response_format: { type: "json_object" }
                                      });
                                      const callResult = JSON.parse(agentRes.content || "{}");
                                      callConfig = {
                                          url: callResult.url,
                                          method: callResult.method,
                                          body: callResult.body
                                      };
                                  } catch (err) {
                                      console.error(`[Worker] Fallback agent failed for ${node.external_id}:`, err);
                                      await session.run(
                                          `MATCH (n:\`${sourceSystem}\` { migration_id: $migrationId, external_id: $extId }) 
                                           SET n.transfer_attempts = coalesce(n.transfer_attempts, 0) + 1, 
                                               n.transfer_error = 'Fallback agent failed'`,
                                          { migrationId, extId: String(node.external_id) }
                                      );
                                      transferErrors++;
                                      await upsertChatMessage(liveStatusId, migrationId, 'assistant', JSON.stringify({
                                          type: 'live-transfer-status',
                                          total: totalNodesToTransfer,
                                          processed: totalTransferred + transferErrors,
                                          successCount: totalTransferred,
                                          errorCount: transferErrors,
                                          currentEntity: sourceObjectType,
                                          status: 'running'
                                      }), currentStepNumber);
                                      continue;
                                  }
                              }

                              // EXECUTE TARGET API CALL
                              try {
                                  const targetHeaders: any = { 
                                      "Accept": "application/json",
                                      "Content-Type": "application/json",
                                      ...(targetScheme?.headers || {})
                                  };

                                  // GENERIC AUTH LOGIC
                                  const authConf = targetScheme?.authentication;
                                  const token = targetConnector.api_key || targetConnector.username;
                                  if (token) {
                                      const prefix = authConf?.tokenPrefix !== undefined ? authConf.tokenPrefix : 'Bearer ';
                                      const headerName = authConf?.headerName || 'Authorization';
                                      targetHeaders[headerName] = `${prefix}${token.trim()}`;
                                  }

                                  const finalUrl = callConfig.url.startsWith('http') ? callConfig.url : (targetScheme?.apiBaseUrl || "") + callConfig.url;

                                  const apiRes = await fetch(finalUrl, {
                                      method: callConfig.method,
                                      headers: targetHeaders,
                                      body: callConfig.method === 'GET' ? undefined : JSON.stringify(callConfig.body)
                                  });

                                  if (apiRes.ok) {
                                      const apiData = await apiRes.json();
                                      const targetId = apiData.id || apiData.gid || apiData.key || (apiData.data?.id) || (apiData.data?.gid);

                                      if (targetId) {
                                          await session.run(
                                              `MATCH (n:\`${sourceSystem}\` { migration_id: $migrationId, external_id: $extId }) 
                                               SET n.target_id = $targetId`,
                                              { migrationId, extId: String(node.external_id), targetId: String(targetId) }
                                          );
                                          totalTransferred++;
                                          processedInBatch++;

                                          // Update status message
                                          await upsertChatMessage(liveStatusId, migrationId, 'assistant', JSON.stringify({
                                              type: 'live-transfer-status',
                                              total: totalNodesToTransfer,
                                              processed: totalTransferred + transferErrors,
                                              successCount: totalTransferred,
                                              errorCount: transferErrors,
                                              currentEntity: sourceObjectType,
                                              status: 'running'
                                          }), currentStepNumber);
                                      } else {
                                          console.error(`[Worker] API Response OK but no ID found for ${node.external_id}`);
                                          await session.run(
                                              `MATCH (n:\`${sourceSystem}\` { migration_id: $migrationId, external_id: $extId }) 
                                               SET n.transfer_attempts = coalesce(n.transfer_attempts, 0) + 1, 
                                                   n.transfer_error = 'No ID in response'`,
                                              { migrationId, extId: String(node.external_id) }
                                          );
                                          transferErrors++;
                                          await upsertChatMessage(liveStatusId, migrationId, 'assistant', JSON.stringify({
                                              type: 'live-transfer-status',
                                              total: totalNodesToTransfer,
                                              processed: totalTransferred + transferErrors,
                                              successCount: totalTransferred,
                                              errorCount: transferErrors,
                                              currentEntity: sourceObjectType,
                                              status: 'running'
                                          }), currentStepNumber);
                                      }
                                  } else {
                                      const errText = await apiRes.text();
                                      console.error(`[Worker] API Transfer failed: ${apiRes.status} ${errText}`);
                                      await session.run(
                                          `MATCH (n:\`${sourceSystem}\` { migration_id: $migrationId, external_id: $extId }) 
                                           SET n.transfer_attempts = coalesce(n.transfer_attempts, 0) + 1, 
                                               n.transfer_error = $errText`,
                                          { migrationId, extId: String(node.external_id), errText: `${apiRes.status}: ${errText.substring(0, 200)}` }
                                      );
                                      transferErrors++;
                                      await upsertChatMessage(liveStatusId, migrationId, 'assistant', JSON.stringify({
                                          type: 'live-transfer-status',
                                          total: totalNodesToTransfer,
                                          processed: totalTransferred + transferErrors,
                                          successCount: totalTransferred,
                                          errorCount: transferErrors,
                                          currentEntity: sourceObjectType,
                                          status: 'running'
                                          }), currentStepNumber);
                                  }
                              } catch (apiErr) {
                                  console.error(`[Worker] API Error:`, apiErr);
                                  await session.run(
                                      `MATCH (n:\`${sourceSystem}\` { migration_id: $migrationId, external_id: $extId }) 
                                       SET n.transfer_attempts = coalesce(n.transfer_attempts, 0) + 1, 
                                           n.transfer_error = $errText`,
                                      { migrationId, extId: String(node.external_id), errText: String(apiErr).substring(0, 200) }
                                  );
                                  transferErrors++;                                  await upsertChatMessage(liveStatusId, migrationId, 'assistant', JSON.stringify({
                                      type: 'live-transfer-status',
                                      total: totalNodesToTransfer,
                                      processed: totalTransferred + transferErrors,
                                      successCount: totalTransferred,
                                      errorCount: transferErrors,
                                      currentEntity: sourceObjectType,
                                      status: 'running'
                                  }), currentStepNumber);
                              }
                              
                              await new Promise(r => setTimeout(r, (rateLimitResult.delay || 0.5) * 1000));
                          }
                      } finally {
                          await session.close();
                      }
                  }
              }
          }

          // Final update
          await upsertChatMessage(liveStatusId, migrationId, 'assistant', JSON.stringify({
              type: 'live-transfer-status',
              total: totalNodesToTransfer,
              processed: totalTransferred + transferErrors,
              successCount: totalTransferred,
              errorCount: transferErrors,
              currentEntity: 'Fertig',
              status: 'completed'
          }), currentStepNumber);

          result = { status: 'success', transferredCount: totalTransferred, errors: transferErrors };

      } finally {
          await driver.close();
      }

      const finishClientTransfer = await dbPool.connect();
      try {
        await finishClientTransfer.query('BEGIN');
        await finishClientTransfer.query('UPDATE migration_steps SET status = $1, result = $2, status_message = $3 WHERE id = $4', [
          'completed', result, 'Data transfer completed.', step_id,
        ]);

        const { rows: migRowsFinal } = await finishClientTransfer.query('SELECT workflow_state FROM migrations WHERE id = $1', [migrationId]);
        const { nextState, progress } = updateWorkflowForStep(migRowsFinal[0]?.workflow_state, stepRecord.workflow_step_id || step_id, result, false);
        
        await finishClientTransfer.query('UPDATE migrations SET workflow_state = $1, progress = $2, status = $3, step_status = $4, current_step = $5 WHERE id = $6', [
          nextState, progress, 'processing', 'completed', currentStepNumber, migrationId,
        ]);
        await finishClientTransfer.query('UPDATE jobs SET status = $1 WHERE id = $2', ['completed', job.id]);
        
        // KPI
        await incrementGlobalStats(finishClientTransfer, { steps: 1, success: 1, total_agents: 1 });

        await finishClientTransfer.query('COMMIT');
        
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
        await logActivity(migrationId, 'success', 'Data Transfer abgeschlossen.');
      } catch (e) {
        await finishClientTransfer.query('ROLLBACK');
        throw e;
      } finally {
        finishClientTransfer.release();
      }
      
      return { 
          success: !isLogicalFailure, 
          result, 
          isLogicalFailure 
      };
  }
}
