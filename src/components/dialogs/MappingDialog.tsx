import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Plus, 
  ArrowLeftRight, 
  ChevronLeft, 
  ChevronRight, 
  Trash2, 
  Database, 
  Target, 
  Code,
  Save,
  Loader2,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { databaseClient } from "@/api/databaseClient";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface MappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  migrationId: string;
}

interface EntityField {
  name: string;
  type: string;
}

interface Entity {
  name: string;
  fields: EntityField[];
}

interface MappingTuple {
  sourceEntity: string;
  targetEntity: string;
  fieldMappings: {
    sourceField: string;
    targetField: string;
  }[];
}

const MappingDialog = ({ open, onOpenChange, migrationId }: MappingDialogProps) => {
  const [loading, setLoading] = useState(true);
  const [sourceEntities, setSourceEntities] = useState<Entity[]>([]);
  const [targetEntities, setTargetEntities] = useState<Entity[]>([]);
  
  const [currentSourceIdx, setCurrentSourceIdx] = useState(0);
  const [currentTargetIdx, setCurrentTargetIdx] = useState(0);
  
  const [mappings, setMappings] = useState<MappingTuple[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch entities from step 3 and 4 results
  useEffect(() => {
    const fetchData = async () => {
      if (!open) return;
      setLoading(true);
      try {
        const { data: results } = await databaseClient.fetchMigrationResults(migrationId);
        
        if (results) {
          // Process Source Entities (Step 3)
          const sEntities: Entity[] = (results.step_3 || []).map((res: any) => ({
            name: res.entity_name,
            fields: res.raw_json?.fields || []
          }));
          setSourceEntities(sEntities);

          // Process Target Entities (Step 4)
          const tEntities: Entity[] = (results.step_4?.[0]?.writable_entities || []).map((name: string) => ({
            name,
            fields: [] // Future improvement: fetch actual target schema
          }));
          setTargetEntities(tEntities);

          // Process Existing Mapping (Step 5)
          const step5 = results.step_5?.[0];
          if (step5?.raw_json?.mappings) {
            setMappings(step5.raw_json.mappings);
          }
        }
      } catch (error) {
        console.error("Failed to load entities for mapping:", error);
        toast.error("Fehler beim Laden der System-Entitäten");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [open, migrationId]);

  const activeSource = sourceEntities[currentSourceIdx];
  const activeTarget = targetEntities[currentTargetIdx];

  const currentTuple = useMemo(() => {
    if (!activeSource || !activeTarget) return null;
    return mappings.find(m => 
      m.sourceEntity === activeSource.name && m.targetEntity === activeTarget.name
    ) || {
      sourceEntity: activeSource.name,
      targetEntity: activeTarget.name,
      fieldMappings: []
    };
  }, [mappings, activeSource, activeTarget]);

  const addFieldMapping = (sourceField: string, targetField: string) => {
    setMappings(prev => {
      const existingIdx = prev.findIndex(m => 
        m.sourceEntity === activeSource.name && m.targetEntity === activeTarget.name
      );

      if (existingIdx >= 0) {
        const updated = [...prev];
        const tuple = { ...updated[existingIdx] };
        tuple.fieldMappings = tuple.fieldMappings.filter(f => f.targetField !== targetField);
        tuple.fieldMappings.push({ sourceField, targetField });
        updated[existingIdx] = tuple;
        return updated;
      } else {
        return [...prev, {
          sourceEntity: activeSource.name,
          targetEntity: activeTarget.name,
          fieldMappings: [{ sourceField, targetField }]
        }];
      }
    });
  };

  const removeFieldMapping = (targetField: string) => {
    setMappings(prev => {
      return prev.map(m => {
        if (m.sourceEntity === activeSource.name && m.targetEntity === activeTarget.name) {
          return {
            ...m,
            fieldMappings: m.fieldMappings.filter(f => f.targetField !== targetField)
          };
        }
        return m;
      });
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await databaseClient.updateMigrationResult(migrationId, 5, { mappings });
      toast.success("Mapping erfolgreich gespeichert");
    } catch (error) {
      console.error("Failed to save mappings:", error);
      toast.error("Fehler beim Speichern des Mappings");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1200px] h-[85vh] flex flex-col p-0 overflow-hidden [&>button]:hidden bg-background border-border shadow-2xl">
        <DialogHeader className="p-6 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-primary" />
                Manual Model Mapping
              </DialogTitle>
              <DialogDescription>
                Definieren Sie manuell die Relationen zwischen Quell- und Ziel-Entitäten für Schritt 5.
              </DialogDescription>
            </div>
            <div className="flex items-center gap-4">
              <Button size="sm" onClick={handleSave} disabled={isSaving} className="min-w-[100px]">
                {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Speichern
              </Button>
              <div className="w-px h-8 bg-border mx-2" />
              <DialogClose asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full">
                  <X className="h-5 w-5" />
                  <span className="sr-only">Schließen</span>
                </Button>
              </DialogClose>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-12 h-12 animate-spin text-primary" />
              <span className="text-xs text-muted-foreground font-medium animate-pulse">Lade Systemdaten...</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Entity Selector Slots */}
            <div className="grid grid-cols-2 gap-px bg-border shrink-0">
              <div className="bg-background p-4 flex items-center justify-between gap-4">
                <Button 
                  variant="ghost" size="icon" 
                  onClick={() => setCurrentSourceIdx(prev => (prev > 0 ? prev - 1 : sourceEntities.length - 1))}
                  disabled={sourceEntities.length <= 1}
                >
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <div className="flex-1 text-center">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Database className="w-4 h-4 text-primary" />
                    <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Source Entity</span>
                  </div>
                  <h3 className="font-bold text-lg">{activeSource?.name || "Keine Entitäten"}</h3>
                </div>
                <Button 
                  variant="ghost" size="icon" 
                  onClick={() => setCurrentSourceIdx(prev => (prev < sourceEntities.length - 1 ? prev + 1 : 0))}
                  disabled={sourceEntities.length <= 1}
                >
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </div>

              <div className="bg-background p-4 flex items-center justify-between gap-4">
                <Button 
                  variant="ghost" size="icon" 
                  onClick={() => setCurrentTargetIdx(prev => (prev > 0 ? prev - 1 : targetEntities.length - 1))}
                  disabled={targetEntities.length <= 1}
                >
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <div className="flex-1 text-center">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Target className="w-4 h-4 text-emerald-500" />
                    <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Target Entity</span>
                  </div>
                  <h3 className="font-bold text-lg">{activeTarget?.name || "Keine Entitäten"}</h3>
                </div>
                <Button 
                  variant="ghost" size="icon" 
                  onClick={() => setCurrentTargetIdx(prev => (prev < targetEntities.length - 1 ? prev + 1 : 0))}
                  disabled={targetEntities.length <= 1}
                >
                  <ChevronRight className="w-5 h-5" />
                </Button>
              </div>
            </div>

            {/* Whiteboard Area */}
            <div className="flex-1 grid grid-cols-2 divide-x overflow-hidden">
              <div className="flex flex-col bg-muted/5">
                <div className="p-3 border-b bg-muted/10">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quellfelder</span>
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-2">
                    {(activeSource?.fields || []).map((field) => (
                      <div 
                        key={field.name}
                        className="group flex items-center justify-between p-3 rounded-xl border bg-card hover:border-primary/50 transition-all cursor-pointer shadow-sm"
                        onClick={() => {
                          const firstUnmapped = (activeTarget?.fields.length ? activeTarget.fields : [{name: "Summary"}, {name: "Description"}, {name: "Status"}]).find(f => 
                            !currentTuple?.fieldMappings.some(m => m.targetField === f.name)
                          );
                          if (firstUnmapped) addFieldMapping(field.name, firstUnmapped.name);
                        }}
                      >
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">{field.name}</span>
                          <span className="text-[10px] text-muted-foreground uppercase">{field.type}</span>
                        </div>
                        <Plus className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              <div className="flex flex-col bg-background">
                <div className="p-3 border-b bg-muted/10">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Zielfelder & Mappings</span>
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-3">
                    {(activeTarget && (activeTarget.fields.length === 0 ? ["ID", "Summary", "Description", "Status", "Assignee", "Created_At"] : activeTarget.fields.map(f => f.name))).map((fieldName) => {
                      const name = typeof fieldName === 'string' ? fieldName : (fieldName as any).name;
                      const mapping = currentTuple?.fieldMappings.find(m => m.targetField === name);
                      
                      return (
                        <div 
                          key={name}
                          className={cn(
                            "flex items-center gap-4 p-3 rounded-xl border transition-all",
                            mapping ? "bg-primary/5 border-primary/30 ring-1 ring-primary/10" : "bg-card border-dashed opacity-60"
                          )}
                        >
                          <div className="flex-1 flex flex-col">
                            <span className="text-sm font-semibold">{name}</span>
                            {mapping ? (
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="secondary" className="bg-primary/10 text-primary border-none text-[10px] h-5">
                                  {mapping.sourceField}
                                </Badge>
                                <button 
                                  onClick={() => removeFieldMapping(name)}
                                  className="text-muted-foreground hover:text-destructive transition-colors"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-muted-foreground italic">Nicht zugewiesen</span>
                            )}
                          </div>
                          {!mapping && <Plus className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100" />}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            </div>

            {/* Protocol Section */}
            <div className="shrink-0 h-48 border-t bg-muted/20 flex flex-col">
              <div className="px-4 py-2 border-b bg-background flex items-center gap-2">
                <Code className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Mapping Protokoll (YAML)</span>
              </div>
              <ScrollArea className="flex-1 p-4">
                <pre className="text-[11px] font-mono text-muted-foreground leading-relaxed">
                  {mappings.length > 0 ? (
                    mappings.map(m => (
                      `# Mapping Tuple: ${m.sourceEntity} -> ${m.targetEntity}\n` +
                      `- source: ${m.sourceEntity}\n` +
                      `  target: ${m.targetEntity}\n` +
                      `  fields:\n` +
                      m.fieldMappings.map(fm => `    - ${fm.sourceField}: ${fm.targetField}`).join('\n')
                    )).join('\n\n')
                  ) : (
                    "# Verknüpfen Sie Felder auf dem Whiteboard, um das Protokoll zu generieren..."
                  )}
                </pre>
              </ScrollArea>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default MappingDialog;