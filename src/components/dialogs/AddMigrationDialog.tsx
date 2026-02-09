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
import InfoTooltip from "@/components/InfoTooltip";

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
  const [sourceScope, setSourceScope] = useState(initialData?.scopeConfig?.sourceScope ?? "");
  const [targetName, setTargetName] = useState(initialData?.scopeConfig?.targetName ?? "");
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
      setSourceScope(initialData.scopeConfig?.sourceScope ?? "");
      setTargetName(initialData.scopeConfig?.targetName ?? "");
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
      setSourceScope("");
      setTargetName("");
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
        setSourceScope(initialData.scopeConfig?.sourceScope ?? "");
        setTargetName(initialData.scopeConfig?.targetName ?? "");
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
      scopeConfig: {
        sourceScope: sourceScope.trim() || undefined,
        targetName: targetName.trim() || undefined,
      },
    });

    resetForm();
    onOpenChange(false);
  };

  const hasScopeChanges = isEditMode && (
    sourceScope.trim() !== (initialData?.scopeConfig?.sourceScope ?? "").trim() ||
    targetName.trim() !== (initialData?.scopeConfig?.targetName ?? "").trim()
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border w-full sm:max-w-5xl p-0 overflow-hidden">
        <div className="border-b border-border bg-muted/30 px-6 py-4">
          <DialogHeader className="space-y-1">
            <DialogTitle className="text-xl">
              {title ?? (isEditMode ? "Migration konfigurieren" : "Migration hinzufügen")}
            </DialogTitle>
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
              scopeId: "source-scope",
              scopeValue: sourceScope,
              onScopeChange: setSourceScope,
              scopeLabel: "Quell-Projekt/ID",
              scopeTooltip: "Geben Sie eine spezifische Projekt-ID oder einen Namen an, um nur diesen Bereich zu migrieren. Leer lassen für einen vollständigen Scan.",
              tooltipSide: "right" as const
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
              scopeId: "target-name",
              scopeValue: targetName,
              onScopeChange: setTargetName,
              scopeLabel: "Ziel-Name",
              scopeTooltip: "Name des Projekts im Zielsystem. Leer lassen, um die Benennung der Quelle beizubehalten.",
              tooltipSide: "left" as const
            }].map((section) => (
              <div key={section.title} className="space-y-4 rounded-xl border border-border/70 bg-card/60 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{section.title}</h3>
                </div>

                <div className="grid grid-cols-2 gap-3">
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

                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor={section.scopeId}>{section.scopeLabel}</Label>
                      <InfoTooltip content={section.scopeTooltip} side={section.tooltipSide} />
                    </div>
                    <Input
                      id={section.scopeId}
                      placeholder="Optional"
                      value={section.scopeValue}
                      onChange={(e) => section.onScopeChange(e.target.value)}
                      className="bg-input border-border"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={section.urlId}>API URL</Label>
                  <Input
                    id={section.urlId}
                    type="url"
                    placeholder="https://api.system.com"
                    value={section.urlValue}
                    onChange={(e) => {
                      section.onUrlChange(e.target.value);
                      setError(null);
                    }}
                    className="bg-input border-border"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={section.tokenId}>API-Token</Label>
                    <Input
                      id={section.tokenId}
                      type="password"
                      placeholder="Token"
                      value={section.tokenValue}
                      onChange={(e) => {
                        section.onTokenChange(e.target.value);
                        setError(null);
                      }}
                      className="bg-input border-border"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={section.emailId}>E-Mail</Label>
                    <Input
                      id={section.emailId}
                      type="email"
                      placeholder="Admin Mail"
                      value={section.emailValue}
                      onChange={(e) => {
                        section.onEmailChange(e.target.value);
                        setError(null);
                      }}
                      className="bg-input border-border"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm mr-auto">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
              </div>
            )}

            {hasScopeChanges && !error && (
              <div className="flex items-center gap-2 text-destructive text-sm font-medium animate-in fade-in slide-in-from-left-2 mr-4">
                <AlertCircle className="h-4 w-4" />
                <span>Um Inkonsistenzen zu vermeiden bitte in Schritt 3 zurückgehen</span>
              </div>
            )}

            <Button
              onClick={handleSubmit}
              className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground md:w-auto"
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
