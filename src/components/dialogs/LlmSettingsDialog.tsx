import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Settings, Loader2, Key, Globe, Layers, Brain } from "lucide-react";
import { databaseClient } from "@/api/databaseClient";

interface LlmSettings {
  id?: string;
  provider: "openai" | "anthropic" | "ollama";
  api_key?: string;
  base_url?: string;
  model: string;
}

export function LlmSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<LlmSettings>({
    provider: "openai",
    model: "gpt-4o",
    api_key: "",
    base_url: "https://api.openai.com/v1",
  });
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchSettings();
    }
  }, [open]);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const { data } = await databaseClient.fetchLlmSettings();
      if (data && data.length > 0) {
        setSettings(data[0]);
      }
    } catch (e) {
      console.error("Failed to fetch LLM settings:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Don't send the masked placeholder back to the server
      const payload = { ...settings };
      if (payload.api_key === "************") {
        delete payload.api_key;
      }

      const { error } = await databaseClient.saveLlmSettings(payload);
      if (!error) {
        toast({
          title: "Einstellungen gespeichert",
          description: "Die LLM-Konfiguration wurde erfolgreich aktualisiert.",
        });
        onOpenChange(false);
      } else {
        throw error;
      }
    } catch (e) {
      toast({
        title: "Fehler",
        description: "Die Einstellungen konnten nicht gespeichert werden.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            <DialogTitle>LLM Provider Einstellungen</DialogTitle>
          </div>
          <DialogDescription className="sr-only">
            Konfigurieren Sie Ihre API-Schlüssel und Modellpräferenzen für die KI-Agenten.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground italic">Lade Konfiguration...</p>
          </div>
        ) : (
          <div className="grid gap-6 py-4">
            <div className="grid gap-2">
              <Label htmlFor="provider" className="flex items-center gap-2">
                <Layers className="w-4 h-4" /> Provider
              </Label>
              <Select
                value={settings.provider}
                onValueChange={(v: any) => {
                    const defaultModel = v === 'anthropic' ? 'claude-3-5-sonnet-20240620' : (v === 'ollama' ? 'llama3' : 'gpt-4o');
                    const defaultUrl = v === 'openai' ? 'https://api.openai.com/v1' : (v === 'anthropic' ? 'https://api.anthropic.com/v1' : 'http://localhost:11434/v1');
                    setSettings({ ...settings, provider: v, model: defaultModel, base_url: defaultUrl });
                }}
              >
                <SelectTrigger id="provider">
                  <SelectValue placeholder="Provider auswählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI (ChatGPT)</SelectItem>
                  <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                  <SelectItem value="ollama">Ollama (Local LLM)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="model" className="flex items-center gap-2">
                <Settings className="w-4 h-4" /> Modell Name
              </Label>
              <Input
                id="model"
                value={settings.model}
                onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                placeholder={settings.provider === 'anthropic' ? 'claude-3-5-sonnet-...' : 'gpt-4o'}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="api_key" className="flex items-center gap-2">
                <Key className="w-4 h-4" /> API Key
              </Label>
              <Input
                id="api_key"
                type="password"
                value={settings.api_key || ""}
                onChange={(e) => setSettings({ ...settings, api_key: e.target.value })}
                placeholder="sk-..."
              />
              <p className="text-[10px] text-muted-foreground italic">
                Wird sicher serverseitig in der Datenbank gespeichert.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="base_url" className="flex items-center gap-2">
                <Globe className="w-4 h-4" /> Base URL (Optional)
              </Label>
              <Input
                id="base_url"
                value={settings.base_url || ""}
                onChange={(e) => setSettings({ ...settings, base_url: e.target.value })}
                placeholder="https://api.openai.com/v1"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
