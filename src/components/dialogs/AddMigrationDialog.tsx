import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface DataSource {
  id: string;
  name: string;
  source_type: string;
}

interface AddMigrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (name: string, sourceSystem: string, targetSystem: string) => void;
}

const AddMigrationDialog = ({ open, onOpenChange, onAdd }: AddMigrationDialogProps) => {
  const [name, setName] = useState("");
  const [sourceSystem, setSourceSystem] = useState("");
  const [targetSystem, setTargetSystem] = useState("");
  const [error, setError] = useState(false);
  const [dataSources, setDataSources] = useState<DataSource[]>([]);

  useEffect(() => {
    const loadDataSources = async () => {
      const { data } = await supabase
        .from("data_sources")
        .select("id, name, source_type")
        .eq("is_active", true);
      
      if (data) {
        setDataSources(data);
      }
    };

    if (open) {
      loadDataSources();
    }
  }, [open]);

  const defaultSources = [
    "Jira Atlassian (Cloud)",
    "Jira Atlassian (Server)",
    "Azure DevOps",
    "Monday.com",
    "ClickUp",
  ];

  const defaultTargets = [
    "Asana",
    "Jira Atlassian (Cloud)",
    "Trello",
    "Notion",
    "Linear",
  ];

  const availableTargets = defaultTargets.filter(target => target !== sourceSystem);

  const handleSubmit = () => {
    if (!name.trim() || !sourceSystem || !targetSystem) {
      setError(true);
      return;
    }
    onAdd(name, sourceSystem, targetSystem);
    setName("");
    setSourceSystem("");
    setTargetSystem("");
    setError(false);
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
                setError(false);
              }}
              className="bg-input border-border"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="source-system">Source System</Label>
            <Select value={sourceSystem} onValueChange={(value) => {
              setSourceSystem(value);
              setError(false);
            }}>
              <SelectTrigger id="source-system" className="bg-input border-border">
                <SelectValue placeholder="Select source system" />
              </SelectTrigger>
              <SelectContent>
                {defaultSources.map((source) => (
                  <SelectItem key={source} value={source}>
                    {source}
                  </SelectItem>
                ))}
                {dataSources.length > 0 && (
                  <>
                    <SelectSeparator />
                    {dataSources.map((source) => (
                      <SelectItem key={source.id} value={source.name}>
                        {source.name}
                      </SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="target-system">Target System</Label>
            <Select value={targetSystem} onValueChange={(value) => {
              setTargetSystem(value);
              setError(false);
            }}>
              <SelectTrigger id="target-system" className="bg-input border-border">
                <SelectValue placeholder="Select target system" />
              </SelectTrigger>
              <SelectContent>
                {availableTargets.map((target) => (
                  <SelectItem key={target} value={target}>
                    {target}
                  </SelectItem>
                ))}
                {dataSources.filter(source => source.name !== sourceSystem).length > 0 && (
                  <>
                    <SelectSeparator />
                    {dataSources
                      .filter(source => source.name !== sourceSystem)
                      .map((source) => (
                        <SelectItem key={source.id} value={source.name}>
                          {source.name}
                        </SelectItem>
                      ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4" />
              <span>Bitte füllen Sie alle Felder aus</span>
            </div>
          )}

          <Button
            onClick={handleSubmit}
            className="w-full bg-secondary hover:bg-secondary/90 text-secondary-foreground"
          >
            Start process
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddMigrationDialog;
