import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertCircle, Loader2, Save } from "lucide-react";
import InfoTooltip from "@/components/InfoTooltip";
import { SystemConfigForm } from "./SystemConfigForm";
import { useMigrationConfig } from "@/hooks/useMigrationConfig";

interface MigrationConfigPanelProps {
  migrationId: string;
  projectId?: string | null;
  onClose?: () => void;
  onUpdate?: () => void;
}

const MigrationConfigPanel = ({ migrationId, onClose, onUpdate }: MigrationConfigPanelProps) => {
  const { state, actions } = useMigrationConfig({ migrationId, onUpdate, onClose });

  useEffect(() => {
    actions.loadMigrationData();
  }, [actions.loadMigrationData]);

  if (state.loading) {
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
                value={state.name}
                onChange={(e) => {
                  actions.setName(e.target.value);
                  actions.setError(null);
                }}
                className="bg-input border-border"
              />
            </div>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            <SystemConfigForm
              title="Quellsystem"
              dotColorClass="bg-primary"
              system={state.sourceSystem}
              onSystemChange={actions.setSourceSystem}
              url={state.sourceUrl}
              onUrlChange={actions.setSourceUrl}
              urlPlaceholder="https://api.example.com"
              apiToken={state.sourceApiToken}
              onApiTokenChange={actions.setSourceApiToken}
              email={state.sourceEmail}
              onEmailChange={actions.setSourceEmail}
              setError={actions.setError}
            >
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
                  value={state.sourceScope}
                  onChange={(e) => actions.setSourceScope(e.target.value)}
                  className="bg-input border-border"
                  placeholder="Optional"
                />
              </div>
            </SystemConfigForm>

            <SystemConfigForm
              title="Zielsystem"
              dotColorClass="bg-emerald-500"
              system={state.targetSystem}
              onSystemChange={actions.setTargetSystem}
              url={state.targetUrl}
              onUrlChange={actions.setTargetUrl}
              urlPlaceholder="https://api.target.com"
              apiToken={state.targetApiToken}
              onApiTokenChange={actions.setTargetApiToken}
              email={state.targetEmail}
              onEmailChange={actions.setTargetEmail}
              emailPlaceholder="admin@target.com"
              setError={actions.setError}
            >
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
                  value={state.targetName}
                  onChange={(e) => actions.setTargetName(e.target.value)}
                  className="bg-input border-border"
                  placeholder="Optional"
                />
              </div>
            </SystemConfigForm>
          </div>

          <div className="flex flex-col gap-4 items-center justify-end pt-4 border-t border-border/50 pb-10">
            {state.error && (
              <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 px-4 py-2 rounded-lg">
                <AlertCircle className="h-4 w-4" />
                <span>{state.error}</span>
              </div>
            )}

            {state.hasScopeChanges && !state.error && (
              <div className="flex items-center gap-2 text-amber-500 text-sm font-medium bg-amber-500/10 px-4 py-2 rounded-lg animate-in fade-in">
                <AlertCircle className="h-4 w-4" />
                <span>Hinweis: Änderungen am Scope erfordern ggf. eine Wiederholung von Schritt 3 (Inventur).</span>
              </div>
            )}

            <div className="flex gap-4 w-full md:w-auto">
              <Button
                variant="outline"
                onClick={onClose}
                disabled={state.saving}
                className="flex-1 md:flex-none"
              >
                Abbrechen
              </Button>
              <Button
                onClick={actions.handleSaveClick}
                disabled={state.saving || !state.hasChanges}
                className="flex-1 md:flex-none min-w-[150px]"
              >
                {state.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Speichern
              </Button>
            </div>
          </div>
        </div>

        <Dialog open={state.showSaveDialog} onOpenChange={actions.setShowSaveDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Änderungen speichern</DialogTitle>
              <DialogDescription>
                Möchtest du die Migration neu starten oder mit den aktuellen Änderungen fortfahren?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => actions.setShowSaveDialog(false)}>
                Abbrechen
              </Button>
              <Button variant="secondary" onClick={() => actions.performSave(false)}>
                Fortsetzen
              </Button>
              <Button onClick={() => actions.performSave(true)}>
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