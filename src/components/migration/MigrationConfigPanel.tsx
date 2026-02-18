import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { databaseClient } from "@/api/databaseClient";
import { DATA_SOURCE_TYPE_OPTIONS } from "@/constants/sourceTypes";
import InfoTooltip from "@/components/InfoTooltip";
import type { NewMigrationInput } from "@/types/migration";
import { AUTH_DETAIL_TOKEN } from "@/constants/migrations";

interface MigrationConfigPanelProps {
  migrationId: string;
  projectId?: string | null;
  onClose?: () => void;
  onUpdate?: () => void;
}

const MigrationConfigPanel = ({ migrationId, projectId, onClose, onUpdate }: MigrationConfigPanelProps) => {
  // Global State
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
        scopeConfig: migration.scope_config || {},
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

  useEffect(() => {
    loadMigrationData();
  }, [loadMigrationData]);

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

  const hasScopeChanges = initialData && (
    sourceScope.trim() !== (initialData.scopeConfig?.sourceScope ?? "").trim() ||
    targetName.trim() !== (initialData.scopeConfig?.targetName ?? "").trim()
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="max-w-4xl mx-auto space-y-8">
            <div className="space-y-4">
                <h2 className="text-lg font-semibold">Allgemeine Einstellungen</h2>
                <div className="space-y-2">
                    <Label htmlFor="migration-name">Migrationsname</Label>
                    <Input
                        id="migration-name"
                        value={name}
                        onChange={(e) => {
                            setName(e.target.value);
                            setError(null);
                        }}
                        className="bg-input border-border"
                    />
                </div>
            </div>

            <div className="grid gap-8 md:grid-cols-2">
                    {/* Source System */}
                <div className="space-y-6 p-6 rounded-2xl border border-border/60 bg-card/40">
                    <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-base flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-primary" />
                            Quellsystem
                        </h3>
                    </div>

                    <div className="space-y-4">
                            <div className="space-y-2">
                            <Label htmlFor="source-system">System</Label>
                            <Select
                                value={sourceSystem}
                                onValueChange={(value) => {
                                    setSourceSystem(value);
                                    setError(null);
                                }}
                            >
                                <SelectTrigger id="source-system" className="bg-input border-border">
                                    <SelectValue placeholder="Wählen" />
                                </SelectTrigger>
                                <SelectContent>
                                    {DATA_SOURCE_TYPE_OPTIONS.map((option) => (
                                        <SelectItem key={option} value={option}>
                                            {option}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="source-url">API URL</Label>
                            <Input
                                id="source-url"
                                value={sourceUrl}
                                onChange={(e) => {
                                    setSourceUrl(e.target.value);
                                    setError(null);
                                }}
                                className="bg-input border-border"
                                placeholder="https://api.example.com"
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center gap-1.5">
                                <Label htmlFor="source-scope">Quell-Projekt/ID</Label>
                                <InfoTooltip 
                                    content="Geben Sie eine spezifische Projekt-ID oder einen Namen an, um nur diesen Bereich zu migrieren. Leer lassen für einen vollständigen Scan." 
                                    side="right" 
                                />
                            </div>
                            <Input
                                id="source-scope"
                                value={sourceScope}
                                onChange={(e) => setSourceScope(e.target.value)}
                                className="bg-input border-border"
                                placeholder="Optional"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="source-api-token">API-Token</Label>
                            <Input
                                id="source-api-token"
                                type="password"
                                value={sourceApiToken}
                                onChange={(e) => {
                                    setSourceApiToken(e.target.value);
                                    setError(null);
                                }}
                                className="bg-input border-border"
                                placeholder="Token"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="source-email">E-Mail (Optional)</Label>
                            <Input
                                id="source-email"
                                type="email"
                                value={sourceEmail}
                                onChange={(e) => setSourceEmail(e.target.value)}
                                className="bg-input border-border"
                                placeholder="admin@example.com"
                            />
                        </div>
                    </div>
                </div>

                    {/* Target System */}
                    <div className="space-y-6 p-6 rounded-2xl border border-border/60 bg-card/40">
                    <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-base flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-emerald-500" />
                            Zielsystem
                        </h3>
                    </div>

                    <div className="space-y-4">
                            <div className="space-y-2">
                            <Label htmlFor="target-system">System</Label>
                            <Select
                                value={targetSystem}
                                onValueChange={(value) => {
                                    setTargetSystem(value);
                                    setError(null);
                                }}
                            >
                                <SelectTrigger id="target-system" className="bg-input border-border">
                                    <SelectValue placeholder="Wählen" />
                                </SelectTrigger>
                                <SelectContent>
                                    {DATA_SOURCE_TYPE_OPTIONS.map((option) => (
                                        <SelectItem key={option} value={option}>
                                            {option}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="target-url">API URL</Label>
                            <Input
                                id="target-url"
                                value={targetUrl}
                                onChange={(e) => {
                                    setTargetUrl(e.target.value);
                                    setError(null);
                                }}
                                className="bg-input border-border"
                                placeholder="https://api.target.com"
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center gap-1.5">
                                <Label htmlFor="target-name">Ziel-Name</Label>
                                <InfoTooltip 
                                    content="Name des Projekts im Zielsystem. Leer lassen, um die Benennung der Quelle beizubehalten." 
                                    side="left" 
                                />
                            </div>
                            <Input
                                id="target-name"
                                value={targetName}
                                onChange={(e) => setTargetName(e.target.value)}
                                className="bg-input border-border"
                                placeholder="Optional"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="target-api-token">API-Token</Label>
                            <Input
                                id="target-api-token"
                                type="password"
                                value={targetApiToken}
                                onChange={(e) => {
                                    setTargetApiToken(e.target.value);
                                    setError(null);
                                }}
                                className="bg-input border-border"
                                placeholder="Token"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="target-email">E-Mail (Optional)</Label>
                            <Input
                                id="target-email"
                                type="email"
                                value={targetEmail}
                                onChange={(e) => setTargetEmail(e.target.value)}
                                className="bg-input border-border"
                                placeholder="admin@target.com"
                            />
                        </div>
                    </div>
                </div>
            </div>

                <div className="flex flex-col gap-4 items-center justify-end pt-4 border-t border-border/50 pb-10">
                {error && (
                    <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 px-4 py-2 rounded-lg">
                        <AlertCircle className="h-4 w-4" />
                        <span>{error}</span>
                    </div>
                )}

                {hasScopeChanges && !error && (
                    <div className="flex items-center gap-2 text-amber-500 text-sm font-medium bg-amber-500/10 px-4 py-2 rounded-lg animate-in fade-in">
                        <AlertCircle className="h-4 w-4" />
                        <span>Hinweis: Änderungen am Scope erfordern ggf. eine Wiederholung von Schritt 3 (Inventur).</span>
                    </div>
                )}

                <div className="flex gap-4 w-full md:w-auto">
                    <Button
                        variant="outline"
                        onClick={onClose}
                        disabled={saving}
                        className="flex-1 md:flex-none"
                    >
                        Abbrechen
                    </Button>
                    <Button
                        onClick={handleSaveClick}
                        disabled={saving || !hasChanges}
                        className="flex-1 md:flex-none min-w-[150px]"
                    >
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Speichern
                    </Button>
                </div>
            </div>

        </div>

        <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Änderungen speichern</DialogTitle>
              <DialogDescription>
                Möchtest du die Migration neu starten oder mit den aktuellen Änderungen fortfahren?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
                    Abbrechen
                </Button>
                <Button variant="secondary" onClick={() => performSave(false)}>
                    Fortsetzen
                </Button>
                <Button onClick={() => performSave(true)}>
                    Neu beginnen
                </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default MigrationConfigPanel;
