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
import type { MigrationAuthType } from "@/types/migration";

interface EditMigrationConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (data: {
    name: string;
    apiUrl: string;
    sourceSystem: string;
    targetSystem: string;
    authType: MigrationAuthType;
    apiToken?: string;
    username?: string;
    password?: string;
  }) => void;
  currentData: {
    name: string;
    apiUrl: string;
    sourceSystem: string;
    targetSystem: string;
    authType: MigrationAuthType;
    apiToken?: string;
    username?: string;
  };
}

const EditMigrationConfigDialog = ({
  open,
  onOpenChange,
  onUpdate,
  currentData,
}: EditMigrationConfigDialogProps) => {
  const [name, setName] = useState(currentData.name);
  const [apiUrl, setApiUrl] = useState(currentData.apiUrl);
  const [sourceSystem, setSourceSystem] = useState(currentData.sourceSystem);
  const [targetSystem, setTargetSystem] = useState(currentData.targetSystem);
  const [authType, setAuthType] = useState<MigrationAuthType>(currentData.authType);
  const [apiToken, setApiToken] = useState(currentData.apiToken || "");
  const [username, setUsername] = useState(currentData.username || "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(currentData.name);
      setApiUrl(currentData.apiUrl);
      setSourceSystem(currentData.sourceSystem);
      setTargetSystem(currentData.targetSystem);
      setAuthType(currentData.authType);
      setApiToken(currentData.apiToken || "");
      setUsername(currentData.username || "");
      setPassword("");
      setError(null);
    }
  }, [open, currentData]);

  const handleSubmit = () => {
    if (!name.trim() || !apiUrl.trim() || !sourceSystem || !targetSystem) {
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

    onUpdate({
      name: name.trim(),
      apiUrl: apiUrl.trim(),
      sourceSystem,
      targetSystem,
      authType,
      apiToken: authType === "token" ? apiToken.trim() : undefined,
      username: authType === "credentials" ? username.trim() : undefined,
      password: authType === "credentials" ? password : undefined,
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

          <div className="space-y-2">
            <Label htmlFor="edit-api-url">API-URL</Label>
            <Input
              id="edit-api-url"
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-source-system">Quellsystem</Label>
              <Select value={sourceSystem} onValueChange={setSourceSystem}>
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
              <Label htmlFor="edit-target-system">Zielsystem</Label>
              <Select value={targetSystem} onValueChange={setTargetSystem}>
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
          </div>

          <div className="space-y-3">
            <Label>Authentifizierung</Label>
            <RadioGroup
              value={authType}
              onValueChange={(value) => setAuthType(value as MigrationAuthType)}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="token" id="edit-auth-token" />
                <Label htmlFor="edit-auth-token" className="font-normal cursor-pointer">
                  API Token
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="credentials" id="edit-auth-credentials" />
                <Label
                  htmlFor="edit-auth-credentials"
                  className="font-normal cursor-pointer"
                >
                  Benutzername & Passwort
                </Label>
              </div>
            </RadioGroup>
          </div>

          {authType === "token" && (
            <div className="space-y-2">
              <Label htmlFor="edit-api-token">API Token</Label>
              <Input
                id="edit-api-token"
                type="password"
                placeholder="Token eingeben..."
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
            <>
              <div className="space-y-2">
                <Label htmlFor="edit-username">Benutzername</Label>
                <Input
                  id="edit-username"
                  placeholder="Benutzername"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setError(null);
                  }}
                  className="bg-input border-border"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-password">Passwort</Label>
                <Input
                  id="edit-password"
                  type="password"
                  placeholder="Passwort"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  className="bg-input border-border"
                />
              </div>
            </>
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
