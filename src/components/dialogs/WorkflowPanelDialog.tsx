import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AGENT_WORKFLOW_STEPS } from "@/constants/agentWorkflow";
import { CheckCircle2, Circle, Copy, Loader2, Save, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface WorkflowPanelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  migrationId: string;
}

interface WorkflowStepResult {
  step: number;
  system_mode?: string;
  entity_name?: string;
  raw_json: any;
}

interface MigrationResults {
  step_1: WorkflowStepResult[];
  step_2: WorkflowStepResult[];
  step_3: WorkflowStepResult[];
}

const WorkflowPanelDialog = ({
  open,
  onOpenChange,
  migrationId,
}: WorkflowPanelDialogProps) => {
  const { toast } = useToast();
  const [results, setResults] = useState<MigrationResults | null>(null);
  const [selectedStepIndex, setSelectedStepIndex] = useState<number>(0);
  const [selectedSubItemIndex, setSelectedSubItemIndex] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const fetchResults = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/migrations/${migrationId}/results`);
      if (!response.ok) throw new Error("Fehler beim Laden der Ergebnisse");
      const data = await response.json();
      setResults(data);
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Fehler",
        description: "Agenten-Ergebnisse konnten nicht geladen werden.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchResults();
    }
  }, [open, migrationId]);

  const getStepResults = (stepIndex: number): WorkflowStepResult[] => {
    if (!results) return [];
    const stepNum = stepIndex + 1;
    if (stepNum === 1) return results.step_1;
    if (stepNum === 2) return results.step_2;
    if (stepNum === 3) return results.step_3;
    return [];
  };

  const currentStepResults = getStepResults(selectedStepIndex);
  const currentResult = currentStepResults[selectedSubItemIndex];

  const handleValueChange = (path: string[], value: any) => {
    if (!results) return;
    
    const newResults = { ...results };
    let targetList: WorkflowStepResult[] = [];
    const stepNum = selectedStepIndex + 1;
    
    if (stepNum === 1) targetList = newResults.step_1;
    else if (stepNum === 2) targetList = newResults.step_2;
    else if (stepNum === 3) targetList = newResults.step_3;

    if (targetList[selectedSubItemIndex]) {
      const updatedJson = { ...targetList[selectedSubItemIndex].raw_json };
      let current = updatedJson;
      for (let i = 0; i < path.length - 1; i++) {
        current = current[path[i]];
      }
      current[path[path.length - 1]] = value;
      targetList[selectedSubItemIndex].raw_json = updatedJson;
      setResults(newResults);
    }
  };

  const handleSaveResult = async () => {
    if (!currentResult) return;
    try {
      setIsSaving(true);
      const payload = {
        step: selectedStepIndex + 1,
        system_mode: currentResult.system_mode,
        entity_name: currentResult.entity_name,
        new_json: currentResult.raw_json
      };

      const response = await fetch(`/api/migrations/${migrationId}/results`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error("Speichern fehlgeschlagen");
      
      toast({ title: "Gespeichert", description: "Ergebnis wurde erfolgreich aktualisiert." });
    } catch (error) {
      toast({ variant: "destructive", title: "Fehler", description: "Änderungen konnten nicht gespeichert werden." });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyJson = () => {
    if (currentResult) {
      navigator.clipboard.writeText(JSON.stringify(currentResult.raw_json, null, 2));
      toast({ title: "Kopiert", description: "JSON in Zwischenablage kopiert." });
    }
  };

  const renderJsonEditor = (obj: any, path: string[] = []) => {
    return Object.entries(obj).map(([key, value]) => {
      const currentPath = [...path, key];
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return (
          <div key={currentPath.join('.')} className="mt-4 first:mt-0">
            <h4 className="text-xs font-bold uppercase text-muted-foreground mb-2 px-1">{key}</h4>
            <div className="pl-4 border-l-2 border-muted space-y-3">
              {renderJsonEditor(value, currentPath)}
            </div>
          </div>
        );
      }

      return (
        <div key={currentPath.join('.')} className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{key}</Label>
          <Input
            value={value === null ? "" : String(value)}
            onChange={(e) => handleValueChange(currentPath, e.target.value)}
            className="h-8 text-sm bg-background"
          />
        </div>
      );
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1200px] h-[85vh] flex flex-col p-0 overflow-hidden [&>button]:hidden">
        <DialogHeader className="p-6 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>Workflow Agent Results</DialogTitle>
              <DialogDescription>
                Übersicht und manuelle Anpassung der erarbeiteten Agenten-Ergebnisse.
              </DialogDescription>
            </div>
            <div className="flex items-center gap-4">
              <Button variant="outline" size="sm" onClick={handleCopyJson} disabled={!currentResult}>
                <Copy className="h-4 w-4 mr-2" />
                JSON Kopieren
              </Button>
              <Button size="sm" onClick={handleSaveResult} disabled={!currentResult || isSaving} className="min-w-[100px]">
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Speichern
              </Button>
              <div className="w-px h-8 bg-border mx-2" />
              <DialogClose asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full ml-2">
                  <X className="h-5 w-5" />
                  <span className="sr-only">Schließen</span>
                </Button>
              </DialogClose>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 flex min-h-0">
          {/* Linke Seite: Flow / Schritte */}
          <div className="w-[350px] border-r bg-muted/10 flex flex-col">
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-6 relative">
                {/* Visual Connector Line */}
                <div className="absolute left-[19px] top-4 bottom-4 w-0.5 bg-border -z-10" />
                
                {AGENT_WORKFLOW_STEPS.map((step, idx) => {
                  const stepResults = getStepResults(idx);
                  const hasData = stepResults.length > 0;
                  const isSelected = selectedStepIndex === idx;

                  return (
                    <div key={step.id} className="space-y-2">
                      <button
                        onClick={() => {
                          setSelectedStepIndex(idx);
                          setSelectedSubItemIndex(0);
                        }}
                        className={cn(
                          "w-full flex items-start gap-4 p-3 rounded-xl transition-all text-left group",
                          isSelected ? "bg-background shadow-md ring-1 ring-primary/20" : "hover:bg-background/50"
                        )}
                      >
                        <div className={cn(
                          "mt-0.5 shrink-0 w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors",
                          hasData ? "border-emerald-500 bg-emerald-500/10 text-emerald-600" : "border-muted bg-muted/50 text-muted-foreground",
                          isSelected && !hasData && "border-primary text-primary bg-primary/5"
                        )}>
                          {hasData ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                        </div>
                        <div className="min-w-0">
                          <p className={cn("text-xs font-bold uppercase tracking-wider", isSelected ? "text-primary" : "text-muted-foreground")}>
                            Schritt {idx + 1}
                          </p>
                          <h3 className="text-sm font-semibold truncate">{step.title}</h3>
                          {hasData && (
                            <Badge variant="outline" className="mt-1 text-[10px] bg-emerald-500/5 text-emerald-600 border-emerald-500/20">
                              {stepResults.length} Resultat{stepResults.length > 1 ? 'e' : ''}
                            </Badge>
                          )}
                        </div>
                      </button>

                      {/* Sub-items (Source/Target or Entities) */}
                      {isSelected && hasData && (
                        <div className="ml-14 flex flex-col gap-1 pr-2 animate-in slide-in-from-left-2 duration-200">
                          {stepResults.map((res, subIdx) => (
                            <button
                              key={subIdx}
                              onClick={() => setSelectedSubItemIndex(subIdx)}
                              className={cn(
                                "text-xs px-3 py-2 rounded-lg text-left transition-colors truncate",
                                selectedSubItemIndex === subIdx 
                                  ? "bg-primary text-primary-foreground font-medium shadow-sm" 
                                  : "bg-muted/50 hover:bg-muted text-muted-foreground"
                              )}
                            >
                              {res.system_mode ? (res.system_mode === 'source' ? 'Quellsystem' : 'Zielsystem') : (res.entity_name || `Resultat ${subIdx + 1}`)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Rechte Seite: Editor */}
          <div className="flex-1 bg-background flex flex-col">
            {loading ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mb-4" />
                <p>Ergebnisse werden geladen...</p>
              </div>
            ) : currentResult ? (
              <ScrollArea className="flex-1 p-8">
                <div className="max-w-2xl mx-auto space-y-8">
                  <div className="flex items-center justify-between pb-4 border-b">
                    <div>
                      <h2 className="text-xl font-bold">Ergebnis Details</h2>
                      <p className="text-sm text-muted-foreground">
                        {currentResult.system_mode 
                          ? `${currentResult.system_mode === 'source' ? 'Quellsystem' : 'Zielsystem'} Konfiguration`
                          : `Inventar: ${currentResult.entity_name}`}
                      </p>
                    </div>
                  </div>
                  
                  <div className="grid gap-6">
                    {renderJsonEditor(currentResult.raw_json)}
                  </div>
                </div>
              </ScrollArea>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Circle className="h-8 w-8 opacity-20" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-1">Keine Daten vorhanden</h3>
                <p className="max-w-xs">
                  Für diesen Schritt wurden bisher noch keine strukturierten Ergebnisse vom Agenten erarbeitet.
                </p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WorkflowPanelDialog;