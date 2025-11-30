import { useCallback, useEffect, useState } from "react";
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
import type { NewMigrationInput } from "@/types/migration";

interface AddMigrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (migration: NewMigrationInput) => void;
  mode?: "create" | "edit";
  initialData?: Partial<NewMigrationInput>;
  title?: string;
  submitLabel?: string;
}

const AddMigrationDialog = ({
  open,
  onOpenChange,
  onSubmit,
  mode = "create",
  initialData,
  title,
  submitLabel,
}: AddMigrationDialogProps) => {
  const isEditMode = mode === "edit";
  const [name, setName] = useState(initialData?.name ?? "");
  const [sourceUrl, setSourceUrl] = useState(initialData?.sourceUrl ?? "");
  const [targetUrl, setTargetUrl] = useState(initialData?.targetUrl ?? "");
  const [sourceSystem, setSourceSystem] = useState(initialData?.sourceSystem ?? "");
  const [targetSystem, setTargetSystem] = useState(initialData?.targetSystem ?? "");
  const [sourceApiToken, setSourceApiToken] = useState(initialData?.sourceAuth?.apiToken ?? "");
  const [targetApiToken, setTargetApiToken] = useState(initialData?.targetAuth?.apiToken ?? "");
  const [sourceEmail, setSourceEmail] = useState(initialData?.sourceAuth?.email ?? "");
  const [targetEmail, setTargetEmail] = useState(initialData?.targetAuth?.email ?? "");
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    if (isEditMode && initialData) {
      setName(initialData.name ?? "");
      setSourceUrl(initialData.sourceUrl ?? "");
      setTargetUrl(initialData.targetUrl ?? "");
      setSourceSystem(initialData.sourceSystem ?? "");
      setTargetSystem(initialData.targetSystem ?? "");
      setSourceApiToken(initialData.sourceAuth?.apiToken ?? "");
      setTargetApiToken(initialData.targetAuth?.apiToken ?? "");
      setSourceEmail(initialData.sourceAuth?.email ?? "");
      setTargetEmail(initialData.targetAuth?.email ?? "");
    } else {
      setName("");
      setSourceUrl("");
      setTargetUrl("");
      setSourceSystem("");
      setTargetSystem("");
      setSourceApiToken("");
      setTargetApiToken("");
      setSourceEmail("");
      setTargetEmail("");
    }
    setError(null);
  }, [initialData, isEditMode]);

  useEffect(() => {
    if (open) {
      if (isEditMode && initialData) {
        setName(initialData.name ?? "");
        setSourceUrl(initialData.sourceUrl ?? "");
        setTargetUrl(initialData.targetUrl ?? "");
        setSourceSystem(initialData.sourceSystem ?? "");
        setTargetSystem(initialData.targetSystem ?? "");
        setSourceApiToken(initialData.sourceAuth?.apiToken ?? "");
        setTargetApiToken(initialData.targetAuth?.apiToken ?? "");
        setSourceEmail(initialData.sourceAuth?.email ?? "");
        setTargetEmail(initialData.targetAuth?.email ?? "");
      }
      setError(null);
    } else {
      resetForm();
    }
  }, [open, resetForm, initialData, isEditMode]);

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

    onSubmit({
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

    resetForm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border w-full sm:max-w-5xl p-0 overflow-hidden">
        <div className="border-b border-border bg-muted/30 px-6 py-4">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-xl">
              {title ?? (isEditMode ? "Migration konfigurieren" : "Migration hinzufügen")}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Hinterlege die Ziel- und Quellverbindungen deiner Migration. Passwörter werden nicht mehr benötigt – API-Token
              und Kontaktadresse reichen aus.
            </p>
          </DialogHeader>
        </div>

        <div className="grid gap-6 px-6 py-5">
          <div className="space-y-2">
            <Label htmlFor="migration-name">Migrationsname</Label>
            <Input
              id="migration-name"
              placeholder="z. B. CRM zu Data Warehouse"
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
              systemId: "source-system",
              systemValue: sourceSystem,
              onSystemChange: setSourceSystem,
              urlId: "source-url",
              urlValue: sourceUrl,
              onUrlChange: setSourceUrl,
              tokenId: "source-api-token",
              tokenValue: sourceApiToken,
              onTokenChange: setSourceApiToken,
              emailId: "source-email",
              emailValue: sourceEmail,
              onEmailChange: setSourceEmail,
            }, {
              title: "Zielsystem",
              systemId: "target-system",
              systemValue: targetSystem,
              onSystemChange: setTargetSystem,
              urlId: "target-url",
              urlValue: targetUrl,
              onUrlChange: setTargetUrl,
              tokenId: "target-api-token",
              tokenValue: targetApiToken,
              onTokenChange: setTargetApiToken,
              emailId: "target-email",
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

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
              </div>
            )}

            <Button
              onClick={handleSubmit}
              className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground md:w-auto md:ml-auto"
            >
              {submitLabel ?? (isEditMode ? "Änderungen speichern" : "Migration hinzufügen")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddMigrationDialog;
