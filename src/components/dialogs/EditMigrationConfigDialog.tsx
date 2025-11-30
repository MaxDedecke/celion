import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
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

  useEffect(() => {
    if (open) {
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

    onUpdate({
      name: name.trim(),
      sourceUrl: sourceUrl.trim(),
      targetUrl: targetUrl.trim(),
      sourceSystem,
      targetSystem,
      sourceAuth: {
        authType: "token",
        apiToken: sourceApiToken.trim(),
        email: sourceEmail.trim(),
      },
      targetAuth: {
        authType: "token",
        apiToken: targetApiToken.trim(),
        email: targetEmail.trim(),
      },
    });

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border w-full sm:max-w-4xl p-0 overflow-hidden">
        <div className="border-b border-border bg-muted/30 px-6 py-4">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-xl">Migrationskonfiguration bearbeiten</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Aktualisiere Systeme, URLs und Tokens deiner Migration. Passwörter werden nicht mehr gespeichert.
            </p>
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
                      {DATA_SOURCE_TYPE_OPTIONS.map((option) => (
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
