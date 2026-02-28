import { forwardRef } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import InfoTooltip from "@/components/InfoTooltip";
import type { DataSourceFormData } from "@/types/dataSource";

interface BasicInfoStepProps {
  formData: DataSourceFormData;
  setFormData: (data: DataSourceFormData) => void;
  sourceTypeOptions: string[];
}

export const BasicInfoStep = forwardRef<HTMLInputElement, BasicInfoStepProps>(
  ({ formData, setFormData, sourceTypeOptions }, ref) => {
    return (
      <div className="space-y-6">
        <Alert className="border-border/50 bg-muted/40">
          <AlertTitle>Grunddaten klar benennen</AlertTitle>
          <AlertDescription className="space-y-2 text-sm text-muted-foreground">
            <p>Vergeben Sie einen eindeutigen Namen, der System und Umgebung widerspiegelt (z. B. „Salesforce PROD“).</p>
            <p>Prüfen Sie, ob die angegebene URL ohne VPN erreichbar ist oder zusätzliche Infrastruktur benötigt.</p>
          </AlertDescription>
        </Alert>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="name">Name</Label>
              <InfoTooltip
                content={
                  <div className="space-y-1">
                    <p>Nutzen Sie eine sprechende Bezeichnung inkl. System, Mandant oder Region.</p>
                    <p>Dies erleichtert das Auffinden in der Projektübersicht.</p>
                  </div>
                }
              />
            </div>
            <Input
              id="name"
              ref={ref}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="source_type">Typ</Label>
              <InfoTooltip
                content={
                  <div className="space-y-1">
                    <p>Wählen Sie das System oder Protokoll, das am besten passt.</p>
                    <p>Fehlt ein Typ, nutzen Sie den generischen Eintrag „custom“.</p>
                  </div>
                }
              />
            </div>
            <Select
              value={formData.source_type}
              onValueChange={(value) => setFormData({ ...formData, source_type: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Quelle auswählen" />
              </SelectTrigger>
              <SelectContent>
                {sourceTypeOptions.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="api_url">API URL</Label>
            <InfoTooltip
              content={
                <div className="space-y-1">
                  <p>Tragen Sie die vollständige Basis-URL inklusive Protokoll ein.</p>
                  <p>Bei Subpfaden (z. B. /api/v1) bitte den gesamten Pfad ergänzen.</p>
                </div>
              }
            />
          </div>
          <Input
            id="api_url"
            value={formData.api_url}
            onChange={(e) => setFormData({ ...formData, api_url: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">Beispiel: https://api.system.de/v1</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Aktiv</Label>
            <div className="flex items-center justify-between rounded-2xl border border-border/50 px-3 py-2">
              <span className="text-sm text-muted-foreground">Connector aktiv</span>
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Global verfügbar</Label>
            <div className="flex items-center justify-between rounded-2xl border border-border/50 px-3 py-2">
              <span className="text-sm text-muted-foreground">Für alle Projekte verfügbar</span>
              <Switch
                checked={formData.is_global}
                onCheckedChange={(checked) => setFormData({ ...formData, is_global: checked })}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }
);
BasicInfoStep.displayName = "BasicInfoStep";