import { AgentBase } from '../core/AgentBase';
import neo4j from 'neo4j-driver';
import { loadScheme } from '../../lib/scheme-loader';
import { resolveOpenAiConfig, buildOpenAiHeaders } from '../openai/openaiClient';
import { runDataTransformation } from '../agentService';
import { OrchestratorAgent } from './orchestrator/OrchestratorAgent';

export class DataTransferAgent extends AgentBase {
  async execute(params: any): Promise<any> {
    const { stepNumber, migrationId, dbPool } = this.context;
    
    if (!dbPool) {
        return { success: false, error: "Database pool not provided in context", isLogicalFailure: true };
    }
    
    let result;
    
    // We mock the worker variables/functions to match the context
    const currentStepNumber = stepNumber;
    
    const writeChatMessage = async (role: string, content: string, stepNum?: number) => {
        return await this.context.writeChatMessage(role, content, stepNum || currentStepNumber);
    };
    
    const upsertChatMessage = async (id: string | null, role: string, content: string, stepNum?: number) => {
        if (this.context.upsertChatMessage) {
            return await this.context.upsertChatMessage(id, role, content, stepNum || currentStepNumber);
        }
        return undefined;
    };
    
    const logActivity = async (type: any, title: string) => {
       if (this.context.logActivity) await this.context.logActivity(type, title);
    };
    
    // Some worker variables that we don't need but they are referenced
    const step_id = params?.stepId || null;
    const job = { id: params?.jobId || '00000000-0000-0000-0000-000000000000' };
    const stepRecord = params?.stepRecord || {};
    
    // We shouldn't actually do the final state commit inside the agent, but to keep the code unchanged:
    const updateWorkflowForStep = (state: any, id: string, res: any, err: boolean) => { return { nextState: state, progress: 0 }; };
    const incrementGlobalStats = async (...args: any[]) => {};
    const AGENT_WORKFLOW_STEPS: any[] = [];
    
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

      // --- EXECUTION PHASE ---
      
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
              
              const requestedType = scopeConfig.targetContainerType;
              const availableTypes = targetScheme.exportInstructions?.availableContainerTypes || [];
              const preferredType = targetScheme.exportInstructions?.preferredContainerType || "project";
              const isSupported = availableTypes.some((t: any) => t.id === requestedType);
              const targetContainerType = isSupported ? requestedType : preferredType;

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
                      await writeChatMessage('assistant', `Der zuvor erstellte Ziel-Container (ID: ${targetScopeId}) wurde nicht mehr im Zielsystem gefunden. Ich setze den Transfer-Status zurück und lege den Container neu an...`, currentStepNumber);

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
          await writeChatMessage('assistant', `Phase 0: Bereite Ziel-Container in **${targetSystem}** vor...`, currentStepNumber);
          
          const { rows: targetConnectorRows } = await dbPool.query('SELECT api_url, api_key, username, auth_type FROM connectors WHERE migration_id = $1 AND connector_type = $2', [migrationId, 'out']);
          const targetConnector = targetConnectorRows[0];
          const targetScheme = await loadScheme(targetSystem);
          
          if (targetConnector && targetScheme) {
              const { apiKey, baseUrl, projectId: openAiProjectId } = await resolveOpenAiConfig();
              const openAiHeaders = buildOpenAiHeaders(apiKey, openAiProjectId);
              
              // Bestimme Container-Typ (Nutzerwahl oder System-Standard)
              const requestedType = scopeConfig.targetContainerType;
              const availableTypes = targetScheme.exportInstructions?.availableContainerTypes || [];
              const preferredType = targetScheme.exportInstructions?.preferredContainerType || "project";
              
              // Prüfe, ob der gewählte Typ für dieses System überhaupt unterstützt wird
              const isSupported = availableTypes.some((t: any) => t.id === requestedType);
              let targetContainerType = isSupported ? requestedType : preferredType;

              const containerPrompt = `
Du bist ein Cloud-Integrations-Experte. Erstelle den API-Call, um einen neuen Haupt-Container im System **${targetSystem}** zu erstellen.

### ZIEL-SYSTEM INFOS:
${JSON.stringify(targetScheme, null, 2)}

### ZIEL-CONNECTOR URL (enthält ggf. wichtige IDs wie Parent-Page, Workspace oder Team):
${targetConnector.api_url}

### AUFGABE:
Erstelle einen Container vom Typ **"${targetContainerType}"** mit dem Namen: **"${preferredTargetName}"**.

### WICHTIGE SYSTEM-SPEZIFISCHE REGELN:
- **NOTION:** Falls das Zielsystem Notion ist, musst du zwingend ein "parent" Objekt im Body mitsenden. 
  Extrahiere die Parent-ID aus der Connector-URL (der 32-stellige Hex-Code am Ende).
  Beispiel Body für Notion: { "parent": { "type": "page_id", "page_id": "DEINE_EXTRAHIERTE_ID" }, "properties": { "title": [{ "text": { "content": "${preferredTargetName}" } }] } }
- **ANDERE SYSTEME:** Falls du eine Team-ID oder Workspace-ID aus der Connector-URL extrahieren kannst, nutze diese für den API-Call (z.B. in der URL oder im Body).

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
                              await writeChatMessage('assistant', `Ziel-Container **"${preferredTargetName}"** (${targetContainerType}) erfolgreich erstellt (ID: ${targetScopeId}).`, currentStepNumber);
                          }
                      } else {
                          const errText = await apiRes.text();
                          console.error(`[Worker] Container creation failed: ${errText}`);
                          if (targetSystem === 'Notion') {
                            throw new Error(`Notion-Container konnte nicht erstellt werden: ${errText}`);
                          }
                          await writeChatMessage('assistant', `⚠️ Konnte Container nicht automatisch erstellen. Nutze Standard-Scope.`, currentStepNumber);
                      }
              } catch (err) {
                  console.error(`[Worker] Error in Phase 0:`, err);
                  throw err; // Re-throw to stop execution
              }
          }
      }

      await writeChatMessage('assistant', 'Phase 1: Datenveredelung in Neo4j...', currentStepNumber);

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
            await writeChatMessage('assistant', `Veredele Entität: **${entityType}**...`, currentStepNumber);
            
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
                      await writeChatMessage('assistant', `Fortschritt ${entityType}: **${processedInEntity}** Objekte veredelt...`, currentStepNumber);
                  }
                  
                  await new Promise(resolve => setTimeout(resolve, 500));
                }
              } finally {
                await session.close();
              }
            }
          }
          await writeChatMessage('assistant', 'Datenveredelung in Neo4j erfolgreich abgeschlossen.', currentStepNumber);
        } finally {
          await driver.close();
        }
      } else {
        await writeChatMessage('assistant', 'Keine Qualitäts-Enhancements konfiguriert. Überspringe Phase 1.', currentStepNumber);
      }

      // Phase 2: Orchestrator-Driven Data Transfer
      await writeChatMessage('assistant', 'Phase 2: Orchestrator startet den Transfer der Daten...', currentStepNumber);
      
      const targetScheme = await loadScheme(targetSystem);
      const sourceScheme = await loadScheme(sourceSystem);
      
      const { rows: allRules } = await dbPool.query('SELECT * FROM public.mapping_rules WHERE migration_id = $1 AND rule_type != \'IGNORE\'', [migrationId]);

      if (allRules.length === 0) {
          throw new Error("Keine aktiven Mappings gefunden. Bitte konfiguriere die Mapping-Regeln (nicht auf IGNORE), bevor du den Transfer startest.");
      }

      // Extrahiere alle zu migrierenden Entitäten
      const sourceEntitiesSet = new Set<string>();
      const targetEntitiesSet = new Set<string>();
      
      for (const rule of allRules) {
        sourceEntitiesSet.add(rule.source_object);
        targetEntitiesSet.add(rule.target_object);
      }
      
      const sourceEntities = Array.from(sourceEntitiesSet);
      const targetEntities = Array.from(targetEntitiesSet);

      try {
        const orchestrator = new OrchestratorAgent(this.provider, {
            ...this.context,
            // Override getConnector to easily pass it down
            getConnector: async (type: 'in' | 'out') => {
                const { rows } = await dbPool.query('SELECT api_url, api_key, username, auth_type FROM connectors WHERE migration_id = $1 AND connector_type = $2', [migrationId, type]);
                return rows[0];
            }
        });

        await orchestrator.execute({
            migrationId,
            initialPlan: scopeConfig.execution_plan,
            mappingRules: allRules,
            sourceSchema: sourceScheme,
            targetSchema: targetScheme,
            sourceEntities,
            targetEntities,
            sourceSystem,
            targetSystem,
            targetScopeId
        } as any); // Passing extra params that Orchestrator might pass to Subagent

        result = { status: 'success' };
      } catch (err: any) {
        console.error("[DataTransferAgent] Orchestrator failed:", err);
        throw new Error(`Transfer fehlgeschlagen: ${err.message}`);
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
            await writeChatMessage('system', actionContent, currentStepNumber);
        }
        await logActivity('success', 'Data Transfer abgeschlossen.');
      } catch (e) {
        await finishClientTransfer.query('ROLLBACK');
        throw e;
      } finally {
        finishClientTransfer.release();
      }
      
      let isLogicalFailure = false;
      return { 
          success: !isLogicalFailure, 
          result, 
          isLogicalFailure 
      };
  }
}
