import { Pool } from 'pg';

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
  }

  // 3. Save entities (Inventory)
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
