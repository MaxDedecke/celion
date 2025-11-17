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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DATA_SOURCE_TYPE_OPTIONS } from "@/constants/sourceTypes";
import type { MigrationAuthType, NewMigrationInput } from "@/types/migration";

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
  const initialSourceAuthType = initialData?.sourceAuth?.authType ?? "token";
  const initialTargetAuthType = initialData?.targetAuth?.authType ?? "token";
  const [sourceAuthType, setSourceAuthType] = useState<MigrationAuthType>(initialSourceAuthType);
  const [targetAuthType, setTargetAuthType] = useState<MigrationAuthType>(initialTargetAuthType);
  const [sourceApiToken, setSourceApiToken] = useState(initialData?.sourceAuth?.apiToken ?? "");
  const [targetApiToken, setTargetApiToken] = useState(initialData?.targetAuth?.apiToken ?? "");
  const [sourceUsername, setSourceUsername] = useState(initialData?.sourceAuth?.username ?? "");
  const [targetUsername, setTargetUsername] = useState(initialData?.targetAuth?.username ?? "");
  const [sourcePassword, setSourcePassword] = useState(initialData?.sourceAuth?.password ?? "");
  const [targetPassword, setTargetPassword] = useState(initialData?.targetAuth?.password ?? "");
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    if (isEditMode && initialData) {
      setName(initialData.name ?? "");
      setSourceUrl(initialData.sourceUrl ?? "");
      setTargetUrl(initialData.targetUrl ?? "");
      setSourceSystem(initialData.sourceSystem ?? "");
      setTargetSystem(initialData.targetSystem ?? "");
      setSourceAuthType(initialSourceAuthType);
      setTargetAuthType(initialTargetAuthType);
      setSourceApiToken(initialData.sourceAuth?.apiToken ?? "");
      setTargetApiToken(initialData.targetAuth?.apiToken ?? "");
      setSourceUsername(initialData.sourceAuth?.username ?? "");
      setTargetUsername(initialData.targetAuth?.username ?? "");
      setSourcePassword(initialData.sourceAuth?.password ?? "");
      setTargetPassword(initialData.targetAuth?.password ?? "");
    } else {
      setName("");
      setSourceUrl("");
      setTargetUrl("");
      setSourceSystem("");
      setTargetSystem("");
      setSourceAuthType("token");
      setTargetAuthType("token");
      setSourceApiToken("");
      setTargetApiToken("");
      setSourceUsername("");
      setTargetUsername("");
      setSourcePassword("");
      setTargetPassword("");
    }
    setError(null);
  }, [initialData, initialSourceAuthType, initialTargetAuthType, isEditMode]);

  useEffect(() => {
    if (open) {
      if (isEditMode && initialData) {
        setName(initialData.name ?? "");
        setSourceUrl(initialData.sourceUrl ?? "");
        setTargetUrl(initialData.targetUrl ?? "");
        setSourceSystem(initialData.sourceSystem ?? "");
        setTargetSystem(initialData.targetSystem ?? "");
        setSourceAuthType(initialSourceAuthType);
        setTargetAuthType(initialTargetAuthType);
        setSourceApiToken(initialData.sourceAuth?.apiToken ?? "");
        setTargetApiToken(initialData.targetAuth?.apiToken ?? "");
        setSourceUsername(initialData.sourceAuth?.username ?? "");
        setTargetUsername(initialData.targetAuth?.username ?? "");
        setSourcePassword("");
        setTargetPassword("");
      }
      setError(null);
    } else {
      resetForm();
    }
  }, [open, resetForm, initialData, isEditMode, initialSourceAuthType, initialTargetAuthType]);

  const handleSubmit = () => {
    if (!name.trim() || !sourceUrl.trim() || !targetUrl.trim() || !sourceSystem || !targetSystem) {
      setError("Bitte fülle alle Pflichtfelder aus.");
      return;
    }

    if (sourceAuthType === "token" && !sourceApiToken.trim()) {
      setError("Bitte hinterlege einen API Token für das Quellsystem.");
      return;
    }

    if (targetAuthType === "token" && !targetApiToken.trim()) {
      setError("Bitte hinterlege einen API Token für das Zielsystem.");
      return;
    }

    const requiresSourcePassword =
      sourceAuthType === "credentials" && (!isEditMode || initialData?.sourceAuth?.authType !== "credentials");

    const requiresTargetPassword =
      targetAuthType === "credentials" && (!isEditMode || initialData?.targetAuth?.authType !== "credentials");

    if (sourceAuthType === "credentials" && !sourceUsername.trim()) {
      setError("Bitte hinterlege Benutzername und Passwort für das Quellsystem.");
      return;
    }

    if (targetAuthType === "credentials" && !targetUsername.trim()) {
      setError("Bitte hinterlege Benutzername und Passwort für das Zielsystem.");
      return;
    }

    if (requiresSourcePassword && !sourcePassword) {
      setError("Bitte hinterlege Benutzername und Passwort für das Quellsystem.");
      return;
    }

    if (requiresTargetPassword && !targetPassword) {
      setError("Bitte hinterlege Benutzername und Passwort für das Zielsystem.");
      return;
    }

    onSubmit({
      name: name.trim(),
      sourceUrl: sourceUrl.trim(),
      targetUrl: targetUrl.trim(),
      sourceSystem,
      targetSystem,
      sourceAuth: {
        authType: sourceAuthType,
        apiToken: sourceAuthType === "token" ? sourceApiToken.trim() : undefined,
        username: sourceAuthType === "credentials" ? sourceUsername.trim() : undefined,
        password: sourceAuthType === "credentials" ? sourcePassword || undefined : undefined,
      },
      targetAuth: {
        authType: targetAuthType,
        apiToken: targetAuthType === "token" ? targetApiToken.trim() : undefined,
        username: targetAuthType === "credentials" ? targetUsername.trim() : undefined,
        password: targetAuthType === "credentials" ? targetPassword || undefined : undefined,
      },
    });

    resetForm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border w-full sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {title ?? (isEditMode ? "Migration konfigurieren" : "Migration hinzufügen")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="migration-name">Migrationsname</Label>
            <Input
              id="migration-name"
              placeholder="Name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              className="bg-input border-border"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3 rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold">Quellsystem</h3>
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
                <Label htmlFor="source-url">API-URL</Label>
                <Input
                  id="source-url"
                  type="url"
                  placeholder="https://source-api.partner.de"
                  value={sourceUrl}
                  onChange={(e) => {
                    setSourceUrl(e.target.value);
                    setError(null);
                  }}
                  className="bg-input border-border"
                />
              </div>
              <div className="space-y-2">
                <Label>Authentifizierung</Label>
                <RadioGroup
                  value={sourceAuthType}
                  onValueChange={(value) => {
                    setSourceAuthType(value as MigrationAuthType);
                    setError(null);
                  }}
                  className="grid gap-3"
                >
                  <div
                    className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${sourceAuthType === "token" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                  >
                    <RadioGroupItem value="token" id="source-auth-token" className="mt-1" />
                    <div>
                      <Label htmlFor="source-auth-token" className="text-sm font-medium">
                        API-Token
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Verwende einen bestehenden Token für den Zugriff auf die Quelle.
                      </p>
                    </div>
                  </div>
                  <div
                    className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${sourceAuthType === "credentials" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                  >
                    <RadioGroupItem value="credentials" id="source-auth-credentials" className="mt-1" />
                    <div>
                      <Label htmlFor="source-auth-credentials" className="text-sm font-medium">
                        Benutzername &amp; Passwort
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Hinterlege dedizierte Zugangsdaten für das Quellsystem.
                      </p>
                    </div>
                  </div>
                </RadioGroup>
              </div>
              {sourceAuthType === "token" && (
                <div className="space-y-2">
                  <Label htmlFor="source-api-token">API-Token</Label>
                  <Input
                    id="source-api-token"
                    type="password"
                    placeholder="API-Token"
                    value={sourceApiToken}
                    onChange={(e) => {
                      setSourceApiToken(e.target.value);
                      setError(null);
                    }}
                    className="bg-input border-border"
                  />
                </div>
              )}
              {sourceAuthType === "credentials" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="source-username">Benutzername</Label>
                    <Input
                      id="source-username"
                      placeholder="api-benutzer"
                      value={sourceUsername}
                      onChange={(e) => {
                        setSourceUsername(e.target.value);
                        setError(null);
                      }}
                      className="bg-input border-border"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="source-password">Passwort</Label>
                    <Input
                      id="source-password"
                      type="password"
                      placeholder="••••••••"
                      value={sourcePassword}
                      onChange={(e) => {
                        setSourcePassword(e.target.value);
                        setError(null);
                      }}
                      className="bg-input border-border"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold">Zielsystem</h3>
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
                <Label htmlFor="target-url">API-URL</Label>
                <Input
                  id="target-url"
                  type="url"
                  placeholder="https://target-api.partner.de"
                  value={targetUrl}
                  onChange={(e) => {
                    setTargetUrl(e.target.value);
                    setError(null);
                  }}
                  className="bg-input border-border"
                />
              </div>
              <div className="space-y-2">
                <Label>Authentifizierung</Label>
                <RadioGroup
                  value={targetAuthType}
                  onValueChange={(value) => {
                    setTargetAuthType(value as MigrationAuthType);
                    setError(null);
                  }}
                  className="grid gap-3"
                >
                  <div
                    className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${targetAuthType === "token" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                  >
                    <RadioGroupItem value="token" id="target-auth-token" className="mt-1" />
                    <div>
                      <Label htmlFor="target-auth-token" className="text-sm font-medium">
                        API-Token
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Verwende einen bestehenden Token für das Zielsystem.
                      </p>
                    </div>
                  </div>
                  <div
                    className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${targetAuthType === "credentials" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                  >
                    <RadioGroupItem value="credentials" id="target-auth-credentials" className="mt-1" />
                    <div>
                      <Label htmlFor="target-auth-credentials" className="text-sm font-medium">
                        Benutzername &amp; Passwort
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Hinterlege dedizierte Zugangsdaten für das Zielsystem.
                      </p>
                    </div>
                  </div>
                </RadioGroup>
              </div>
              {targetAuthType === "token" && (
                <div className="space-y-2">
                  <Label htmlFor="target-api-token">API-Token</Label>
                  <Input
                    id="target-api-token"
                    type="password"
                    placeholder="API-Token"
                    value={targetApiToken}
                    onChange={(e) => {
                      setTargetApiToken(e.target.value);
                      setError(null);
                    }}
                    className="bg-input border-border"
                  />
                </div>
              )}
              {targetAuthType === "credentials" && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="target-username">Benutzername</Label>
                    <Input
                      id="target-username"
                      placeholder="api-benutzer"
                      value={targetUsername}
                      onChange={(e) => {
                        setTargetUsername(e.target.value);
                        setError(null);
                      }}
                      className="bg-input border-border"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="target-password">Passwort</Label>
                    <Input
                      id="target-password"
                      type="password"
                      placeholder="••••••••"
                      value={targetPassword}
                      onChange={(e) => {
                        setTargetPassword(e.target.value);
                        setError(null);
                      }}
                      className="bg-input border-border"
                    />
                  </div>
                </div>
              )}
            </div>
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
