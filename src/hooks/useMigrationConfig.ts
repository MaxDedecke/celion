import { useState, useCallback } from "react";
import { databaseClient } from "@/api/databaseClient";
import { toast } from "sonner";
import type { NewMigrationInput } from "@/types/migration";
import { AUTH_DETAIL_TOKEN } from "@/constants/migrations";

interface UseMigrationConfigProps {
  migrationId: string;
  onUpdate?: () => void;
  onClose?: () => void;
}

export function useMigrationConfig({ migrationId, onUpdate, onClose }: UseMigrationConfigProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [sourceSystem, setSourceSystem] = useState("");
  const [targetSystem, setTargetSystem] = useState("");
  const [sourceApiToken, setSourceApiToken] = useState("");
  const [targetApiToken, setTargetApiToken] = useState("");
  const [sourceEmail, setSourceEmail] = useState("");
  const [targetEmail, setTargetEmail] = useState("");
  const [sourceScope, setSourceScope] = useState("");
  const [targetName, setTargetName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Original data for comparison
  const [initialData, setInitialData] = useState<NewMigrationInput | null>(null);

  const loadMigrationData = useCallback(async () => {
    if (!migrationId) return;
    try {
      setLoading(true);
      const { data: migration, error: migrationError } = await databaseClient.fetchMigrationById(migrationId);
      if (migrationError || !migration) throw migrationError || new Error("Migration not found");

      // Load connector data
      const [sourceConnectorRes, targetConnectorRes] = await Promise.all([
        databaseClient.fetchConnectorByType(migrationId, 'in'),
        databaseClient.fetchConnectorByType(migrationId, 'out')
      ]);

      const sourceConnector = sourceConnectorRes.data;
      const targetConnector = targetConnectorRes.data;

      const loadedData: NewMigrationInput = {
        name: migration.name,
        sourceUrl: sourceConnector?.api_url || migration.source_url || "",
        targetUrl: targetConnector?.api_url || migration.target_url || "",
        sourceSystem: migration.source_system,
        targetSystem: migration.target_system,
        sourceAuth: {
          authType: "token",
          apiToken: sourceConnector?.api_key || "",
          email: sourceConnector?.username || "",
        },
        targetAuth: {
          authType: "token",
          apiToken: targetConnector?.api_key || "",
          email: targetConnector?.username || "",
        },
        scopeConfig: (migration.scope_config as any) || {},
      };

      setInitialData(loadedData);

      // Set form state
      setName(loadedData.name);
      setSourceUrl(loadedData.sourceUrl);
      setTargetUrl(loadedData.targetUrl);
      setSourceSystem(loadedData.sourceSystem);
      setTargetSystem(loadedData.targetSystem);
      setSourceApiToken(loadedData.sourceAuth.apiToken || "");
      setTargetApiToken(loadedData.targetAuth.apiToken || "");
      setSourceEmail(loadedData.sourceAuth.email || "");
      setTargetEmail(loadedData.targetAuth.email || "");
      setSourceScope(loadedData.scopeConfig?.sourceScope || "");
      setTargetName(loadedData.scopeConfig?.targetName || "");

    } catch (error) {
      console.error("Error loading migration data", error);
      toast.error("Fehler beim Laden der Migrationsdaten");
    } finally {
      setLoading(false);
    }
  }, [migrationId]);

  const hasChanges = initialData ? (
    name.trim() !== initialData.name ||
    sourceUrl.trim() !== initialData.sourceUrl ||
    targetUrl.trim() !== initialData.targetUrl ||
    sourceSystem !== initialData.sourceSystem ||
    targetSystem !== initialData.targetSystem ||
    sourceApiToken.trim() !== (initialData.sourceAuth.apiToken || "") ||
    targetApiToken.trim() !== (initialData.targetAuth.apiToken || "") ||
    sourceEmail.trim() !== (initialData.sourceAuth.email || "") ||
    targetEmail.trim() !== (initialData.targetAuth.email || "") ||
    sourceScope.trim() !== (initialData.scopeConfig?.sourceScope || "") ||
    targetName.trim() !== (initialData.scopeConfig?.targetName || "")
  ) : false;

  const hasScopeChanges = initialData && (
    sourceScope.trim() !== (initialData.scopeConfig?.sourceScope ?? "").trim() ||
    targetName.trim() !== (initialData.scopeConfig?.targetName ?? "").trim()
  );

  const handleSaveClick = () => {
    if (!migrationId) return;

    if (!name.trim() || !sourceUrl.trim() || !targetUrl.trim() || !sourceSystem || !targetSystem) {
      setError("Bitte fülle alle Pflichtfelder aus.");
      return;
    }

    if (!sourceApiToken.trim()) {
      setError("Bitte hinterlege einen API Token für das Quellsystem.");
      return;
    }

    if (!targetApiToken.trim()) {
      setError("Bitte hinterlege einen API Token für das Zielsystem.");
      return;
    }
    
    setShowSaveDialog(true);
  };

  const performSave = async (shouldRestart: boolean) => {
    setShowSaveDialog(false);
    setSaving(true);
    setError(null);

    try {
      const scopeConfig = {
        sourceScope: sourceScope.trim() || undefined,
        targetName: targetName.trim() || undefined,
      };

      const migrationUpdates: any = {
        name: name.trim(),
        source_system: sourceSystem,
        target_system: targetSystem,
        source_url: sourceUrl.trim(),
        target_url: targetUrl.trim(),
        in_connector_detail: sourceUrl.trim(),
        out_connector_detail: AUTH_DETAIL_TOKEN,
        scope_config: scopeConfig,
      };

      if (shouldRestart) {
        migrationUpdates.status = "not_started";
        migrationUpdates.current_step = 0;
        migrationUpdates.step_status = "idle";
        migrationUpdates.progress = 0;
        migrationUpdates.workflow_state = {};
      }

      // Update migration
      const { error: migrationError } = await databaseClient.updateMigration(migrationId, migrationUpdates);

      if (migrationError) throw migrationError;

      const sourceConnectorUpdates = {
        api_url: sourceUrl.trim(),
        auth_type: "api_key",
        api_key: sourceApiToken.trim(),
        username: sourceEmail.trim() || null,
      };

      const targetConnectorUpdates = {
        api_url: targetUrl.trim(),
        auth_type: "api_key",
        api_key: targetApiToken.trim(),
        username: targetEmail.trim() || null,
      };

      // Update source connector
      const { error: sourceConnectorError } = await databaseClient.updateConnectorByType(
        migrationId,
        'in',
        sourceConnectorUpdates
      );
      if (sourceConnectorError) throw sourceConnectorError;

      // Update target connector
      const { error: targetConnectorError } = await databaseClient.updateConnectorByType(
        migrationId,
        'out',
        targetConnectorUpdates
      );
      if (targetConnectorError) throw targetConnectorError;

      toast.success(shouldRestart ? "Konfiguration gespeichert und Migration zurückgesetzt" : "Konfiguration erfolgreich gespeichert");
      
      onUpdate?.();
      onClose?.();

    } catch (error) {
      console.error("Error saving configuration", error);
      toast.error("Fehler beim Speichern der Konfiguration");
      setError("Speichern fehlgeschlagen. Bitte versuche es erneut.");
    } finally {
      setSaving(false);
    }
  };

  return {
    state: {
      loading,
      saving,
      showSaveDialog,
      name,
      sourceUrl,
      targetUrl,
      sourceSystem,
      targetSystem,
      sourceApiToken,
      targetApiToken,
      sourceEmail,
      targetEmail,
      sourceScope,
      targetName,
      error,
      hasChanges,
      hasScopeChanges,
    },
    actions: {
      setShowSaveDialog,
      setName,
      setSourceUrl,
      setTargetUrl,
      setSourceSystem,
      setTargetSystem,
      setSourceApiToken,
      setTargetApiToken,
      setSourceEmail,
      setTargetEmail,
      setSourceScope,
      setTargetName,
      setError,
      handleSaveClick,
      performSave,
      loadMigrationData,
    }
  };
}