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
  const [authType, setAuthType] = useState<MigrationAuthType>(initialData?.authType ?? "token");
  const [apiToken, setApiToken] = useState(initialData?.apiToken ?? "");
  const [username, setUsername] = useState(initialData?.username ?? "");
  const [password, setPassword] = useState(initialData?.password ?? "");
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    if (isEditMode && initialData) {
      setName(initialData.name ?? "");
      setSourceUrl(initialData.sourceUrl ?? "");
      setTargetUrl(initialData.targetUrl ?? "");
      setSourceSystem(initialData.sourceSystem ?? "");
      setTargetSystem(initialData.targetSystem ?? "");
      setAuthType(initialData.authType ?? "token");
      setApiToken(initialData.apiToken ?? "");
      setUsername(initialData.username ?? "");
      setPassword(initialData.password ?? "");
    } else {
      setName("");
      setSourceUrl("");
      setTargetUrl("");
      setSourceSystem("");
      setTargetSystem("");
      setAuthType("token");
      setApiToken("");
      setUsername("");
      setPassword("");
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
        setAuthType(initialData.authType ?? "token");
        setApiToken(initialData.apiToken ?? "");
        setUsername(initialData.username ?? "");
        setPassword(initialData.password ?? "");
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

    if (authType === "token" && !apiToken.trim()) {
      setError("Bitte hinterlege einen API Token.");
      return;
    }

    const requiresPassword =
      authType === "credentials" && (!isEditMode || initialData?.authType !== "credentials");

    if (authType === "credentials" && !username.trim()) {
      setError("Bitte hinterlege Benutzername und Passwort.");
      return;
    }

    if (requiresPassword && !password) {
      setError("Bitte hinterlege Benutzername und Passwort.");
      return;
    }

    onSubmit({
      name: name.trim(),
      sourceUrl: sourceUrl.trim(),
      targetUrl: targetUrl.trim(),
      sourceSystem,
      targetSystem,
      authType,
      apiToken: authType === "token" ? apiToken.trim() : undefined,
      username: authType === "credentials" ? username.trim() : undefined,
      password: authType === "credentials" ? password || undefined : undefined,
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
            </div>
          </div>

          <div className="space-y-2">
            <Label>Authentifizierung</Label>
            <RadioGroup
              value={authType}
              onValueChange={(value) => {
                setAuthType(value as MigrationAuthType);
                setError(null);
              }}
              className="grid gap-3 md:grid-cols-2"
            >
              <div className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${authType === "token" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                <RadioGroupItem value="token" id="auth-token" className="mt-1" />
                <div>
                  <Label htmlFor="auth-token" className="text-sm font-medium">API-Token</Label>
                  <p className="text-xs text-muted-foreground">
                    Verwende einen bestehenden Token für den Zugriff auf die API.
                  </p>
                </div>
              </div>
              <div className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${authType === "credentials" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                <RadioGroupItem value="credentials" id="auth-credentials" className="mt-1" />
                <div>
                  <Label htmlFor="auth-credentials" className="text-sm font-medium">Benutzername & Passwort</Label>
                  <p className="text-xs text-muted-foreground">
                    Hinterlege dedizierte Zugangsdaten für diese Migration.
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>

          {authType === "token" && (
            <div className="space-y-2 md:max-w-md">
              <Label htmlFor="api-token">API-Token</Label>
              <Input
                id="api-token"
                type="password"
                placeholder="API-Token"
                value={apiToken}
                onChange={(e) => {
                  setApiToken(e.target.value);
                  setError(null);
                }}
                className="bg-input border-border"
              />
            </div>
          )}

          {authType === "credentials" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="username">Benutzername</Label>
                <Input
                  id="username"
                  placeholder="api-benutzer"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setError(null);
                  }}
                  className="bg-input border-border"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Passwort</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  className="bg-input border-border"
                />
              </div>
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between">
            {error && (
              <div className="flex items-center gap-2 text-destructive text-sm">
                <AlertCircle className="h-4 w-4" />
                <span>{error}</span>
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
