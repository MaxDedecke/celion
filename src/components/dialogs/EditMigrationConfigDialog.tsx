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
  const [error, setError] = useState<string | null>(null);
  const [dataSources, setDataSources] = useState<DataSourceRow[]>([]);

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

          <div className="grid gap-4 md:grid-cols-2">
            {[{
              title: "Quellsystem",
              systemId: "edit-source-system",
              systemValue: sourceSystem,
              onSystemChange: setSourceSystem,
              urlId: "edit-source-url",
              urlValue: sourceUrl,
              onUrlChange: setSourceUrl,
              tokenId: "edit-source-api-token",
              tokenValue: sourceApiToken,
              onTokenChange: setSourceApiToken,
              emailId: "edit-source-email",
              emailValue: sourceEmail,
              onEmailChange: setSourceEmail,
            }, {
              title: "Zielsystem",
              systemId: "edit-target-system",
              systemValue: targetSystem,
              onSystemChange: setTargetSystem,
              urlId: "edit-target-url",
              urlValue: targetUrl,
              onUrlChange: setTargetUrl,
              tokenId: "edit-target-api-token",
              tokenValue: targetApiToken,
              onTokenChange: setTargetApiToken,
              emailId: "edit-target-email",
              emailValue: targetEmail,
              onEmailChange: setTargetEmail,
            }].map((section) => (
              <div key={section.title} className="space-y-4 rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{section.title}</h3>
                  <span className="rounded-full bg-secondary/20 px-3 py-1 text-[11px] font-medium text-secondary-foreground">
                    Zugangsdaten
                  </span>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={section.systemId}>System</Label>
                  <Select
                    value={section.systemValue}
                    onValueChange={(value) => {
                      section.onSystemChange(value);
                      setError(null);
                    }}
                  >
                    <SelectTrigger id={section.systemId} className="bg-input border-border">
                      <SelectValue placeholder="System wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueSystemOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={section.urlId}>URL</Label>
                  <Input
                    id={section.urlId}
                    type="url"
                    placeholder="https://partner.de"
                    value={section.urlValue}
                    onChange={(e) => {
                      section.onUrlChange(e.target.value);
                      setError(null);
                    }}
                    className="bg-input border-border"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={section.tokenId}>API-Token</Label>
                  <Input
                    id={section.tokenId}
                    type="password"
                    placeholder="Sicherer Zugriffstoken"
                    value={section.tokenValue}
                    onChange={(e) => {
                      section.onTokenChange(e.target.value);
                      setError(null);
                    }}
                    className="bg-input border-border"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={section.emailId}>Kontakt E-Mail</Label>
                  <Input
                    id={section.emailId}
                    type="email"
                    placeholder="team@partner.de"
                    value={section.emailValue}
                    onChange={(e) => {
                      section.onEmailChange(e.target.value);
                      setError(null);
                    }}
                    className="bg-input border-border"
                  />
                </div>
              </div>
            ))}
          </div>

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
