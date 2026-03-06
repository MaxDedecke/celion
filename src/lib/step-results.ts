import { Pool } from 'pg';

export async function updateMigrationContext(pool: Pool, migrationId: string, newFacts: Record<string, any>) {
  await pool.query(
    `UPDATE public.migrations 
     SET context = context || $1::jsonb,
         updated_at = now() 
     WHERE id = $2`,
    [JSON.stringify(newFacts), migrationId]
  );
}

export async function saveStep1Result(pool: Pool, migrationId: string, mode: string, result: any) {
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

  // Update global memory
  if (result.detected_system || result.systemName) {
    await updateMigrationContext(pool, migrationId, {
      [`${mode}_system`]: result.detected_system || result.systemName,
      [`${mode}_base_url`]: result.recommendedBaseUrl || null,
      [`${mode}_api_type`]: result.apiTypeDetected || null
    });
  }
}

export async function saveStep2Result(pool: Pool, migrationId: string, mode: string, result: any) {
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

  // Update global memory
  if (result.authenticated ?? result.success) {
    await updateMigrationContext(pool, migrationId, {
      [`${mode}_is_authenticated`]: true,
      [`${mode}_auth_type`]: result.authType || result.auth_method || null
    });
  }
}

export async function saveStep3Result(pool: Pool, migrationId: string, result: any) {
  // 1. Update overall complexity score
  if (result.complexityScore !== undefined) {
    await pool.query('UPDATE public.migrations SET complexity_score = $1 WHERE id = $2', [result.complexityScore, migrationId]);
  }

  // 2. Save identified scope name if available
  if (result.scope && result.scope.name) {
    await pool.query(
      "UPDATE public.migrations SET scope_config = jsonb_set(COALESCE(scope_config, '{}'::jsonb), '{sourceScopeName}', to_jsonb($1::text)) WHERE id = $2",
      [result.scope.name, migrationId]
    );
    await updateMigrationContext(pool, migrationId, {
      source_scope_name: result.scope.name,
      source_scope_id: result.scope.id || null
    });
  }

  // 3. Save entities (Inventory)
  if (result.entities && Array.isArray(result.entities)) {
    let totalItems = 0;
    const inventory: Record<string, number> = {};
    for (const entity of result.entities) {
      const count = entity.count || 0;
      totalItems += count;
      inventory[entity.name] = count;

      await pool.query(
        `INSERT INTO public.step_3_results (migration_id, entity_name, count, complexity, error_message, raw_json)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (migration_id, entity_name) DO UPDATE SET
           count = EXCLUDED.count,
           complexity = EXCLUDED.complexity,
           error_message = EXCLUDED.error_message,
           raw_json = EXCLUDED.raw_json,
           created_at = now()`,
        [migrationId, entity.name, count, entity.complexity, entity.error, entity]
      );
    }
    
    await updateMigrationContext(pool, migrationId, {
      source_total_items_estimated: totalItems,
      source_inventory: inventory
    });
  }
}

export async function saveStep4Result(pool: Pool, migrationId: string, result: any) {
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

  // Update global memory
  if (result.targetScope) {
    if (result.targetScope.name) {
        await pool.query(
          "UPDATE public.migrations SET scope_config = jsonb_set(COALESCE(scope_config, '{}'::jsonb), '{targetName}', to_jsonb($1::text)) WHERE id = $2",
          [result.targetScope.name, migrationId]
        );
    }

    await updateMigrationContext(pool, migrationId, {
      target_scope_id: result.targetScope.id || null,
      target_scope_name: result.targetScope.name || null,
      target_scope_status: result.targetScope.status || null
    });
  }
}

export async function saveStep5Result(pool: Pool, migrationId: string, result: any) {
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

export async function saveStep6Result(pool: Pool, migrationId: string, result: any) {
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

export async function saveStep7Result(pool: Pool, migrationId: string, result: any) {
  await pool.query(
    `INSERT INTO public.step_7_results (migration_id, summary, raw_json)
     VALUES ($1, $2, $3)
     ON CONFLICT (migration_id) DO UPDATE SET
       summary = EXCLUDED.summary,
       raw_json = EXCLUDED.raw_json,
       created_at = now()`,
    [migrationId, result.summary || 'Quality Enhancement abgeschlossen.', result]
  );
}

export async function saveStep8Result(pool: Pool, migrationId: string, result: any) {
  await pool.query(
    `INSERT INTO public.step_8_results (migration_id, summary, raw_json)
     VALUES ($1, $2, $3)
     ON CONFLICT (migration_id) DO UPDATE SET
       summary = EXCLUDED.summary,
       raw_json = EXCLUDED.raw_json,
       created_at = now()`,
    [
      migrationId, 
      `Transfer abgeschlossen: ${result.transferredCount || 0} Objekte erfolgreich übertragen, ${result.errors || 0} Fehler.`, 
      result
    ]
  );
}

export async function saveStep9Result(pool: Pool, migrationId: string, result: any) {
  await pool.query(
    `INSERT INTO public.step_9_results (migration_id, summary, raw_json)
     VALUES ($1, $2, $3)
     ON CONFLICT (migration_id) DO UPDATE SET
       summary = EXCLUDED.summary,
       raw_json = EXCLUDED.raw_json,
       created_at = now()`,
    [
      migrationId, 
      `Verifizierung abgeschlossen: ${result.verified || 0} Objekte validiert, ${result.failed || 0} fehlgeschlagen.`, 
      result
    ]
  );
}
