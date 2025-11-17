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
  const [sourcePassword, setSourcePassword] = useState(currentData.sourceAuth.password ?? "");
  const [targetPassword, setTargetPassword] = useState(currentData.targetAuth.password ?? "");
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
      setSourcePassword(currentData.sourceAuth.password ?? "");
      setTargetPassword(currentData.targetAuth.password ?? "");
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

    if (!sourceEmail.trim() || !sourcePassword) {
      setError("Bitte hinterlege E-Mail und Passwort für das Quellsystem.");
      return;
    }

    if (!targetEmail.trim() || !targetPassword) {
      setError("Bitte hinterlege E-Mail und Passwort für das Zielsystem.");
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
        password: sourcePassword,
      },
      targetAuth: {
        authType: "token",
        apiToken: targetApiToken.trim(),
        email: targetEmail.trim(),
        password: targetPassword,
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-source-email">E-Mail</Label>
                <Input
                  id="edit-source-email"
                  type="email"
                  placeholder="team@partner.de"
                  value={sourceEmail}
                  onChange={(e) => {
                    setSourceEmail(e.target.value);
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-target-email">E-Mail</Label>
                <Input
                  id="edit-target-email"
                  type="email"
                  placeholder="team@partner.de"
                  value={targetEmail}
                  onChange={(e) => {
                    setTargetEmail(e.target.value);
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
