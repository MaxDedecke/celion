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

    if (!sourceEmail.trim()) {
      setError("Bitte hinterlege die E-Mail-Adresse für das Quellsystem.");
      return;
    }

    if (!targetEmail.trim()) {
      setError("Bitte hinterlege die E-Mail-Adresse für das Zielsystem.");
      return;
    }

    onSubmit({
      name: name.trim(),
      sourceUrl: sourceUrl.trim(),
      targetUrl: targetUrl.trim(),
      sourceSystem,
      targetSystem,
      sourceAuth: {
        apiToken: sourceApiToken.trim(),
        email: sourceEmail.trim(),
      },
      targetAuth: {
        apiToken: targetApiToken.trim(),
        email: targetEmail.trim(),
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
                <Label htmlFor="source-email">E-Mail</Label>
                <Input
                  id="source-email"
                  type="email"
                  placeholder="nora@example.com"
                  value={sourceEmail}
                  onChange={(e) => {
                    setSourceEmail(e.target.value);
                    setError(null);
                  }}
                  className="bg-input border-border"
                />
              </div>
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
                <Label htmlFor="target-email">E-Mail</Label>
                <Input
                  id="target-email"
                  type="email"
                  placeholder="nora@example.com"
                  value={targetEmail}
                  onChange={(e) => {
                    setTargetEmail(e.target.value);
                    setError(null);
                  }}
                  className="bg-input border-border"
                />
              </div>
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
