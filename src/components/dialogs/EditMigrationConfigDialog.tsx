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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DATA_SOURCE_TYPE_OPTIONS } from "@/constants/sourceTypes";
import type { MigrationAuthType, MigrationSystemAuthConfig, NewMigrationInput } from "@/types/migration";

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
  const [sourceAuthType, setSourceAuthType] = useState<MigrationAuthType>(currentData.sourceAuth.authType);
  const [targetAuthType, setTargetAuthType] = useState<MigrationAuthType>(currentData.targetAuth.authType);
  const [sourceApiToken, setSourceApiToken] = useState(currentData.sourceAuth.apiToken ?? "");
  const [targetApiToken, setTargetApiToken] = useState(currentData.targetAuth.apiToken ?? "");
  const [sourceUsername, setSourceUsername] = useState(currentData.sourceAuth.username ?? "");
  const [targetUsername, setTargetUsername] = useState(currentData.targetAuth.username ?? "");
  const [sourcePassword, setSourcePassword] = useState("");
  const [targetPassword, setTargetPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(currentData.name);
      setSourceUrl(currentData.sourceUrl);
      setTargetUrl(currentData.targetUrl);
      setSourceSystem(currentData.sourceSystem);
      setTargetSystem(currentData.targetSystem);
      setSourceAuthType(currentData.sourceAuth.authType);
      setTargetAuthType(currentData.targetAuth.authType);
      setSourceApiToken(currentData.sourceAuth.apiToken ?? "");
      setTargetApiToken(currentData.targetAuth.apiToken ?? "");
      setSourceUsername(currentData.sourceAuth.username ?? "");
      setTargetUsername(currentData.targetAuth.username ?? "");
      setSourcePassword("");
      setTargetPassword("");
      setError(null);
    }
  }, [open, currentData]);

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
      sourceAuthType === "credentials" && currentData.sourceAuth.authType !== "credentials";

    const requiresTargetPassword =
      targetAuthType === "credentials" && currentData.targetAuth.authType !== "credentials";

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

    onUpdate({
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

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border w-full sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Migrationskonfiguration bearbeiten</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4 max-h-[70vh] overflow-y-auto">
          <div className="space-y-2">
            <Label htmlFor="edit-migration-name">Migrationsname</Label>
            <Input
              id="edit-migration-name"
              placeholder="Name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              className="bg-input border-border"
            />
          </div>

          <div className="space-y-3 rounded-lg border border-border p-4">
            <h3 className="text-sm font-semibold">Quellsystem</h3>
            <div className="space-y-2">
              <Label htmlFor="edit-source-system">System</Label>
              <Select
                value={sourceSystem}
                onValueChange={(value) => {
                  setSourceSystem(value);
                  setError(null);
                }}
              >
                <SelectTrigger id="edit-source-system" className="bg-input border-border">
                  <SelectValue placeholder="Auswählen..." />
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
              <Label htmlFor="edit-source-url">API-URL</Label>
              <Input
                id="edit-source-url"
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
                  <RadioGroupItem value="token" id="edit-source-auth-token" className="mt-1" />
                  <div>
                    <Label htmlFor="edit-source-auth-token" className="text-sm font-medium">
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
                  <RadioGroupItem value="credentials" id="edit-source-auth-credentials" className="mt-1" />
                  <div>
                    <Label htmlFor="edit-source-auth-credentials" className="text-sm font-medium">
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
                <Label htmlFor="edit-source-api-token">API-Token</Label>
                <Input
                  id="edit-source-api-token"
                  type="password"
                  placeholder="Token eingeben..."
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
                  <Label htmlFor="edit-source-username">Benutzername</Label>
                  <Input
                    id="edit-source-username"
                    placeholder="Benutzername"
                    value={sourceUsername}
                    onChange={(e) => {
                      setSourceUsername(e.target.value);
                      setError(null);
                    }}
                    className="bg-input border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-source-password">Passwort</Label>
                  <Input
                    id="edit-source-password"
                    type="password"
                    placeholder="Passwort"
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
              <Label htmlFor="edit-target-system">System</Label>
              <Select
                value={targetSystem}
                onValueChange={(value) => {
                  setTargetSystem(value);
                  setError(null);
                }}
              >
                <SelectTrigger id="edit-target-system" className="bg-input border-border">
                  <SelectValue placeholder="Auswählen..." />
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
              <Label htmlFor="edit-target-url">API-URL</Label>
              <Input
                id="edit-target-url"
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
                  <RadioGroupItem value="token" id="edit-target-auth-token" className="mt-1" />
                  <div>
                    <Label htmlFor="edit-target-auth-token" className="text-sm font-medium">
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
                  <RadioGroupItem value="credentials" id="edit-target-auth-credentials" className="mt-1" />
                  <div>
                    <Label htmlFor="edit-target-auth-credentials" className="text-sm font-medium">
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
                <Label htmlFor="edit-target-api-token">API-Token</Label>
                <Input
                  id="edit-target-api-token"
                  type="password"
                  placeholder="Token eingeben..."
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
                  <Label htmlFor="edit-target-username">Benutzername</Label>
                  <Input
                    id="edit-target-username"
                    placeholder="Benutzername"
                    value={targetUsername}
                    onChange={(e) => {
                      setTargetUsername(e.target.value);
                      setError(null);
                    }}
                    className="bg-input border-border"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-target-password">Passwort</Label>
                  <Input
                    id="edit-target-password"
                    type="password"
                    placeholder="Passwort"
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
