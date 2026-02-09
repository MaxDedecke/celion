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
  id: string;
  name: string;
  type: string;
}

interface Entity {
  id: string;
  name: string;
  fields: EntityField[];
}

interface MappingTuple {
  sourceEntity: string; // matches Entity.id
  targetEntity: string; // matches Entity.id
  fieldMappings: {
    sourceField: string; // matches EntityField.id
    targetField: string; // matches EntityField.id
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

  // Fetch migration, specs and then existing results
  useEffect(() => {
    const fetchData = async () => {
      if (!open) return;
      setLoading(true);
      try {
        // 1. Fetch Migration to get system names
        const { data: migration } = await databaseClient.fetchMigrationById(migrationId);
        if (!migration) throw new Error("Migration not found");

        // 2. Fetch Specs for both systems in parallel
        const [sourceSpecsRes, targetSpecsRes] = await Promise.all([
          databaseClient.fetchObjectSpecs(migration.source_system),
          databaseClient.fetchObjectSpecs(migration.target_system)
        ]);

        const sSpecs = sourceSpecsRes.data;
        const tSpecs = targetSpecsRes.data;

        if (sSpecs?.objects) {
          setSourceEntities(sSpecs.objects.map((obj: any) => ({
            id: obj.key,
            name: obj.displayName || obj.key,
            fields: (obj.fields || []).map((f: any) => ({
              id: f.id,
              name: f.name || f.id,
              type: f.type || "text"
            }))
          })));
        }

        if (tSpecs?.objects) {
          setTargetEntities(tSpecs.objects.map((obj: any) => ({
            id: obj.key,
            name: obj.displayName || obj.key,
            fields: (obj.fields || []).map((f: any) => ({
              id: f.id,
              name: f.name || f.id,
              type: f.type || "text"
            }))
          })));
        }

        // 3. Fetch Existing Results (Step 5 Mapping)
        const { data: results } = await databaseClient.fetchMigrationResults(migrationId);
        if (results?.step_5?.[0]?.raw_json?.mappings) {
          setMappings(results.step_5[0].raw_json.mappings);
        }
      } catch (error) {
        console.error("Failed to load data for mapping:", error);
        toast.error("Fehler beim Laden der Mapping-Konfiguration");
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
      m.sourceEntity === activeSource.id && m.targetEntity === activeTarget.id
    ) || {
      sourceEntity: activeSource.id,
      targetEntity: activeTarget.id,
      fieldMappings: []
    };
  }, [mappings, activeSource, activeTarget]);

  const addFieldMapping = (sourceFieldId: string, targetFieldId: string) => {
    setMappings(prev => {
      const existingIdx = prev.findIndex(m => 
        m.sourceEntity === activeSource.id && m.targetEntity === activeTarget.id
      );

      if (existingIdx >= 0) {
        const updated = [...prev];
        const tuple = { ...updated[existingIdx] };
        tuple.fieldMappings = tuple.fieldMappings.filter(f => f.targetField !== targetFieldId);
        tuple.fieldMappings.push({ sourceField: sourceFieldId, targetField: targetFieldId });
        updated[existingIdx] = tuple;
        return updated;
      } else {
        return [...prev, {
          sourceEntity: activeSource.id,
          targetEntity: activeTarget.id,
          fieldMappings: [{ sourceField: sourceFieldId, targetField: targetFieldId }]
        }];
      }
    });
  };

  const removeFieldMapping = (targetFieldId: string) => {
    setMappings(prev => {
      return prev.map(m => {
        if (m.sourceEntity === activeSource.id && m.targetEntity === activeTarget.id) {
          return {
            ...m,
            fieldMappings: m.fieldMappings.filter(f => f.targetField !== targetFieldId)
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
              <div className={cn(
                "bg-background p-4 flex items-center justify-between gap-4 transition-all border-b-2",
                activeSource && mappings.some(m => m.sourceEntity === activeSource.id) ? "border-b-primary shadow-[0_4px_12px_-2px_rgba(59,130,246,0.2)]" : "border-b-transparent"
              )}>
                <Button 
                  variant="ghost" size="icon" 
                  onClick={() => setCurrentSourceIdx(prev => (prev > 0 ? prev - 1 : sourceEntities.length - 1))}
                  disabled={sourceEntities.length <= 1}
                >
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <div className="flex-1 text-center">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Database className={cn("w-4 h-4 transition-colors", activeSource && mappings.some(m => m.sourceEntity === activeSource.id) ? "text-primary" : "text-muted-foreground")} />
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

              <div className={cn(
                "bg-background p-4 flex items-center justify-between gap-4 transition-all border-b-2",
                activeTarget && mappings.some(m => m.targetEntity === activeTarget.id) ? "border-b-emerald-500 shadow-[0_4px_12px_-2px_rgba(16,185,129,0.2)]" : "border-b-transparent"
              )}>
                <Button 
                  variant="ghost" size="icon" 
                  onClick={() => setCurrentTargetIdx(prev => (prev > 0 ? prev - 1 : targetEntities.length - 1))}
                  disabled={targetEntities.length <= 1}
                >
                  <ChevronLeft className="w-5 h-5" />
                </Button>
                <div className="flex-1 text-center">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Target className={cn("w-4 h-4 transition-colors", activeTarget && mappings.some(m => m.targetEntity === activeTarget.id) ? "text-emerald-500" : "text-muted-foreground")} />
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
            <div className="flex-1 grid grid-cols-2 divide-x overflow-hidden min-h-0">
              <div className="flex flex-col bg-muted/5 min-h-0">
                <div className="p-3 border-b bg-muted/10 shrink-0">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quellfelder</span>
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-2">
                    {(activeSource?.fields || []).map((field) => {
                      const isMappedLocally = currentTuple?.fieldMappings.some(fm => fm.sourceField === field.id);
                      
                      return (
                        <div 
                          key={field.id}
                          className={cn(
                            "group flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer shadow-sm",
                            isMappedLocally 
                              ? "bg-primary/10 border-primary ring-1 ring-primary/20 shadow-primary/5" 
                              : "bg-card border-border hover:border-primary/50"
                          )}
                          onClick={() => {
                            const targetFields = activeTarget?.fields.length ? activeTarget.fields : [{id: "summary", name: "Summary"}, {id: "description", name: "Description"}, {id: "status", name: "Status"}];
                            const firstUnmapped = targetFields.find(f => 
                              !currentTuple?.fieldMappings.some(m => m.targetField === f.id)
                            );
                            if (firstUnmapped) addFieldMapping(field.id, firstUnmapped.id);
                          }}
                        >
                          <div className="flex flex-col">
                            <span className={cn("text-sm font-medium transition-colors", isMappedLocally ? "text-primary" : "text-foreground")}>{field.name}</span>
                            <span className="text-[10px] text-muted-foreground uppercase">{field.type}</span>
                          </div>
                          <Plus className={cn("w-4 h-4 transition-colors", isMappedLocally ? "text-primary" : "text-muted-foreground group-hover:text-primary")} />
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>

              <div className="flex flex-col bg-background min-h-0">
                <div className="p-3 border-b bg-muted/10 shrink-0">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Zielfelder & Mappings</span>
                </div>
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-3">
                    {(activeTarget && (activeTarget.fields.length === 0 ? [{id: "summary", name: "Summary"}, {id: "description", name: "Description"}] : activeTarget.fields)).map((fieldObj) => {
                      const field = typeof fieldObj === 'string' ? {id: fieldObj, name: fieldObj} : fieldObj;
                      const mapping = currentTuple?.fieldMappings.find(m => m.targetField === field.id);
                      const sourceField = activeSource?.fields.find(f => f.id === mapping?.sourceField);
                      
                      return (
                        <div 
                          key={field.id}
                          className={cn(
                            "flex items-center gap-4 p-3 rounded-xl border transition-all",
                            mapping 
                              ? "bg-emerald-500/10 border-emerald-500 ring-1 ring-emerald-500/20 shadow-emerald-500/5" 
                              : "bg-card border-dashed opacity-60"
                          )}
                        >
                          <div className="flex-1 flex flex-col">
                            <span className={cn("text-sm font-semibold transition-colors", mapping ? "text-emerald-600" : "text-foreground")}>{field.name}</span>
                            {mapping ? (
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-700 border-none text-[10px] h-5 font-bold">
                                  {sourceField?.name || mapping.sourceField}
                                </Badge>
                                <button 
                                  onClick={() => removeFieldMapping(field.id)}
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
            <div className="shrink-0 h-48 border-t bg-muted/20 flex flex-col min-h-0">
              <div className="px-4 py-2 border-b bg-background flex items-center gap-2 shrink-0">
                <Code className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Mapping Protokoll (YAML)</span>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-4">
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
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default MappingDialog;