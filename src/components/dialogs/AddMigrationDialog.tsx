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
import type { MigrationAuthType, NewMigrationInput } from "@/types/migration";

interface AddMigrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (migration: NewMigrationInput) => void;
}

const AddMigrationDialog = ({ open, onOpenChange, onAdd }: AddMigrationDialogProps) => {
  const [name, setName] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [authType, setAuthType] = useState<MigrationAuthType>("token");
  const [apiToken, setApiToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setName("");
    setApiUrl("");
    setAuthType("token");
    setApiToken("");
    setUsername("");
    setPassword("");
    setError(null);
  }, []);

  useEffect(() => {
    if (!open) {
      resetForm();
    } else {
      setError(null);
    }
  }, [open, resetForm]);

  const handleSubmit = () => {
    if (!name.trim() || !apiUrl.trim()) {
      setError("Bitte fülle alle Pflichtfelder aus.");
      return;
    }

    if (authType === "token" && !apiToken.trim()) {
      setError("Bitte hinterlege einen API Token.");
      return;
    }

    if (authType === "credentials" && (!username.trim() || !password)) {
      setError("Bitte hinterlege Benutzername und Passwort.");
      return;
    }

    onAdd({
      name: name.trim(),
      apiUrl: apiUrl.trim(),
      authType,
      apiToken: authType === "token" ? apiToken.trim() : undefined,
      username: authType === "credentials" ? username.trim() : undefined,
      password: authType === "credentials" ? password : undefined,
    });

    resetForm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Add new migration</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="migration-name">Migration Name</Label>
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

          <div className="space-y-2">
            <Label htmlFor="api-url">API URL</Label>
            <Input
              id="api-url"
              type="url"
              placeholder="https://api.partner.de"
              value={apiUrl}
              onChange={(e) => {
                setApiUrl(e.target.value);
                setError(null);
              }}
              className="bg-input border-border"
            />
          </div>

          <div className="space-y-2">
            <Label>Authentifizierung</Label>
            <RadioGroup
              value={authType}
              onValueChange={(value) => {
                setAuthType(value as MigrationAuthType);
                setError(null);
              }}
              className="grid gap-3"
            >
              <div className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${authType === "token" ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                <RadioGroupItem value="token" id="auth-token" className="mt-1" />
                <div>
                  <Label htmlFor="auth-token" className="text-sm font-medium">API Token</Label>
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
            <div className="space-y-2">
              <Label htmlFor="api-token">API Token</Label>
              <Input
                id="api-token"
                type="password"
                placeholder="Token"
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
                  placeholder="api-user"
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
            Migration erstellen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddMigrationDialog;
