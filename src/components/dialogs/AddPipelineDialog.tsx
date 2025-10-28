import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { DATA_SOURCE_TYPE_OPTIONS } from "@/constants/sourceTypes";

interface DataSource {
  id: string;
  name: string;
  source_type: string;
}

interface AddPipelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (pipeline: {
    name: string;
    description?: string;
    sourceSystem: string;
    targetSystem: string;
    sourceDataSourceId?: string;
    targetDataSourceId?: string;
  }) => void;
  targetSystem?: string; // Optional: Pre-fill target system from migration
}

export function AddPipelineDialog({ open, onOpenChange, onAdd, targetSystem }: AddPipelineDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sourceSystem, setSourceSystem] = useState("");
  const [localTargetSystem, setLocalTargetSystem] = useState(targetSystem || "");
  const [sourceDataSourceId, setSourceDataSourceId] = useState<string>("");
  const [targetDataSourceId, setTargetDataSourceId] = useState<string>("");
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (open) {
      fetchDataSources();
      setName("");
      setDescription("");
      setSourceSystem("");
      setLocalTargetSystem(targetSystem || "");
      setSourceDataSourceId("");
      setTargetDataSourceId("");
      setHasError(false);
    }
  }, [open, targetSystem]);

  const fetchDataSources = async () => {
    const { data } = await supabase
      .from("data_sources")
      .select("id, name, source_type")
      .eq("is_active", true);

    if (data) {
      setDataSources(data);
    }
  };

  const handleSubmit = () => {
    if (!name || !sourceSystem || !localTargetSystem) {
      setHasError(true);
      return;
    }

    onAdd({
      name,
      description: description || undefined,
      sourceSystem,
      targetSystem: localTargetSystem,
      sourceDataSourceId: sourceDataSourceId || undefined,
      targetDataSourceId: targetDataSourceId || undefined,
    });

    onOpenChange(false);
  };

  const sourceDataSources = dataSources.filter(ds => ds.source_type === sourceSystem);
  const targetDataSources = dataSources.filter(ds => ds.source_type === localTargetSystem);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Neue Pipeline hinzufügen</DialogTitle>
          <DialogDescription>
            Fügen Sie eine neue API-Verbindung zu dieser Migration hinzu
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="pipeline-name">Name *</Label>
            <Input
              id="pipeline-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Jira Agile → Asana"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="pipeline-description">Beschreibung</Label>
            <Textarea
              id="pipeline-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optionale Beschreibung der Pipeline"
              rows={2}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="source-system">Quellsystem *</Label>
            <Select value={sourceSystem} onValueChange={setSourceSystem}>
              <SelectTrigger id="source-system">
                <SelectValue placeholder="Quellsystem wählen" />
              </SelectTrigger>
              <SelectContent>
                {DATA_SOURCE_TYPE_OPTIONS.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {sourceSystem && sourceDataSources.length > 0 && (
            <div className="grid gap-2">
              <Label htmlFor="source-data-source">Quell-Datenquelle (optional)</Label>
              <Select value={sourceDataSourceId} onValueChange={setSourceDataSourceId}>
                <SelectTrigger id="source-data-source">
                  <SelectValue placeholder="Datenquelle wählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Keine</SelectItem>
                  {sourceDataSources.map((ds) => (
                    <SelectItem key={ds.id} value={ds.id}>
                      {ds.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="target-system">Zielsystem *</Label>
            <Select value={localTargetSystem} onValueChange={setLocalTargetSystem}>
              <SelectTrigger id="target-system">
                <SelectValue placeholder="Zielsystem wählen" />
              </SelectTrigger>
              <SelectContent>
                {DATA_SOURCE_TYPE_OPTIONS.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {localTargetSystem && targetDataSources.length > 0 && (
            <div className="grid gap-2">
              <Label htmlFor="target-data-source">Ziel-Datenquelle (optional)</Label>
              <Select value={targetDataSourceId} onValueChange={setTargetDataSourceId}>
                <SelectTrigger id="target-data-source">
                  <SelectValue placeholder="Datenquelle wählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Keine</SelectItem>
                  {targetDataSources.map((ds) => (
                    <SelectItem key={ds.id} value={ds.id}>
                      {ds.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {hasError && (
            <p className="text-sm text-destructive">
              Bitte füllen Sie alle Pflichtfelder aus
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={handleSubmit}>Pipeline hinzufügen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
