import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DATA_SOURCE_TYPE_OPTIONS } from "@/constants/sourceTypes";
import type { MigrationSystemAuthConfig, NewMigrationInput } from "@/types/migration";
import { databaseClient } from "@/api/databaseClient";
import type { Tables } from "@/integrations/database/types";

type DataSourceRow = Tables<"data_sources">;

interface EditMigrationConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (data: NewMigrationInput) => void;
  currentData: {
    name: string;
    sourceUrl: string;
    targetUrl: string;
    sourceSystem: string;
    targetSystem: string;
    sourceAuth: MigrationSystemAuthConfig;
    targetAuth: MigrationSystemAuthConfig;
  };
}

const EditMigrationConfigDialog = ({
  open,
  onOpenChange,
  onUpdate,
  currentData,
}: EditMigrationConfigDialogProps) => {
  const [name, setName] = useState(currentData.name);
  const [sourceUrl, setSourceUrl] = useState(currentData.sourceUrl);
  const [targetUrl, setTargetUrl] = useState(currentData.targetUrl);
  const [sourceSystem, setSourceSystem] = useState(currentData.sourceSystem);
  const [targetSystem, setTargetSystem] = useState(currentData.targetSystem);
  const [sourceApiToken, setSourceApiToken] = useState(currentData.sourceAuth.apiToken ?? "");
  const [targetApiToken, setTargetApiToken] = useState(currentData.targetAuth.apiToken ?? "");
  const [sourceEmail, setSourceEmail] = useState(currentData.sourceAuth.email ?? "");
  const [targetEmail, setTargetEmail] = useState(currentData.targetAuth.email ?? "");
  const [targetName, setTargetName] = useState(currentData.scopeConfig?.targetName ?? "");
  const [targetContainerType, setTargetContainerType] = useState(currentData.scopeConfig?.targetContainerType ?? "");
  const [availableContainerTypes, setAvailableContainerTypes] = useState<{id: string, name: string}[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dataSources, setDataSources] = useState<DataSourceRow[]>([]);

  useEffect(() => {
    const loadSpecs = async () => {
      if (targetSystem) {
        const { data: specs } = await databaseClient.fetchObjectSpecs(targetSystem);
        if (specs?.exportInstructions?.availableContainerTypes) {
          setAvailableContainerTypes(specs.exportInstructions.availableContainerTypes);
        } else {
          setAvailableContainerTypes([]);
        }
      }
    };
    if (open) {
      loadSpecs();
    }
  }, [open, targetSystem]);

  useEffect(() => {
    const loadDataSources = async () => {
      const { data } = await databaseClient.fetchDataSources();
      if (data) {
        setDataSources(data);
      }
    };
    if (open) {
      loadDataSources();
      setName(currentData.name);
      setSourceUrl(currentData.sourceUrl);
      setTargetUrl(currentData.targetUrl);
      setSourceSystem(currentData.sourceSystem);
      setTargetSystem(currentData.targetSystem);
      setSourceApiToken(currentData.sourceAuth.apiToken ?? "");
      setTargetApiToken(currentData.targetAuth.apiToken ?? "");
      setSourceEmail(currentData.sourceAuth.email ?? "");
      setTargetEmail(currentData.targetAuth.email ?? "");
      setTargetName(currentData.scopeConfig?.targetName ?? "");
      setTargetContainerType(currentData.scopeConfig?.targetContainerType ?? "");
      setError(null);
    }
  }, [open, currentData]);

  const handleSubmit = () => {
    const trimmedName = name.trim();
    const trimmedSourceUrl = sourceUrl.trim();
    const trimmedTargetUrl = targetUrl.trim();
    const trimmedSourceApiToken = sourceApiToken.trim();
    const trimmedTargetApiToken = targetApiToken.trim();
    const trimmedSourceEmail = sourceEmail.trim();
    const trimmedTargetEmail = targetEmail.trim();

    if (!trimmedName || !trimmedSourceUrl || !trimmedTargetUrl || !sourceSystem || !targetSystem) {
      setError("Bitte fülle alle Pflichtfelder aus.");
      return;
    }

    const urlRegex = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/;
    if (!urlRegex.test(trimmedSourceUrl)) {
      setError("Bitte gib eine gültige Quell-URL ein.");
      return;
    }
    if (!urlRegex.test(trimmedTargetUrl)) {
      setError("Bitte gib eine gültige Ziel-URL ein.");
      return;
    }

    if (!trimmedSourceApiToken) {
      setError("Bitte hinterlege einen API Token für das Quellsystem.");
      return;
    }

    if (!trimmedTargetApiToken) {
      setError("Bitte hinterlege einen API Token für das Zielsystem.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (trimmedSourceEmail && !emailRegex.test(trimmedSourceEmail)) {
        setError("Bitte gib eine gültige E-Mail-Adresse für das Quellsystem ein.");
        return;
    }
    if (trimmedTargetEmail && !emailRegex.test(trimmedTargetEmail)) {
        setError("Bitte gib eine gültige E-Mail-Adresse für das Zielsystem ein.");
        return;
    }

    onUpdate({
      name: trimmedName,
      sourceUrl: trimmedSourceUrl,
      targetUrl: trimmedTargetUrl,
      sourceSystem,
      targetSystem,
      sourceAuth: {
        authType: "token",
        apiToken: trimmedSourceApiToken,
        email: trimmedSourceEmail,
      },
      targetAuth: {
        authType: "token",
        apiToken: trimmedTargetApiToken,
        email: trimmedTargetEmail,
      },
      scopeConfig: {
        ...currentData.scopeConfig,
        targetName: targetName.trim(),
        targetContainerType: targetContainerType,
      }
    });

    onOpenChange(false);
  };

  const systemOptions = [ ...DATA_SOURCE_TYPE_OPTIONS, ...dataSources.map(ds => ds.name) ];
  const uniqueSystemOptions = [...new Set(systemOptions)];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border w-full sm:max-w-4xl p-0 overflow-hidden">
        <div className="border-b border-border bg-muted/30 px-6 py-4">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-xl">Migrationskonfiguration bearbeiten</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Aktualisiere Systeme, URLs und Tokens deiner Migration. Passwörter werden nicht mehr gespeichert.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-6 px-6 py-5 max-h-[70vh] overflow-y-auto">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-migration-name">Migrationsname</Label>
              <Input
                id="edit-migration-name"
                placeholder="z. B. Support-Daten migrieren"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                className="bg-input border-border"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="edit-target-scope-name">Ziel-Name (optional)</Label>
              <Input
                id="edit-target-scope-name"
                placeholder="Name des neuen Ziel-Bereichs"
                value={targetName}
                onChange={(e) => {
                  setTargetName(e.target.value);
                  setError(null);
                }}
                className="bg-input border-border"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Source/Target Sections */}
            {[/* ... */].map(/* ... */)}
          </div>

          {availableContainerTypes.length > 0 && (
            <div className="space-y-2 p-4 rounded-xl border border-primary/20 bg-primary/5">
              <Label htmlFor="edit-container-type">Ziel-Struktur (Granularität)</Label>
              <Select value={targetContainerType} onValueChange={setTargetContainerType}>
                <SelectTrigger id="edit-container-type" className="bg-input border-border">
                  <SelectValue placeholder="Wähle die Ziel-Ebene" />
                </SelectTrigger>
                <SelectContent>
                  {availableContainerTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">
                Bestimmt, ob die Daten in einen neuen Workspace oder einen neuen Space/Projekt importiert werden.
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          )}

          <Button
            onClick={handleSubmit}
            className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground"
          >
            Änderungen speichern
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditMigrationConfigDialog;
