import { useState, useEffect, useMemo, useRef } from "react";
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
  X,
  MessageSquare,
  Pencil,
  Check,
  EyeOff,
  Eye
} from "lucide-react";
import { cn } from "@/lib/utils";
import { databaseClient } from "@/api/databaseClient";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import ChatMessageList from "@/components/migration/ChatMessageList";
import ChatInput from "@/components/migration/ChatInput";
import type { ChatMessage } from "@/components/migration/ChatMessage";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

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
  isIgnored?: boolean;
}

interface MappingTuple {
  sourceEntity: string; // matches Entity.id
  targetEntity: string; // matches Entity.id
  fieldMappings: {
    sourceField: string; // matches EntityField.id
    targetField: string; // matches EntityField.id
  }[];
}

interface MappingRule {
  id: string;
  source_system: string;
  source_object: string;
  source_property: string;
  target_system: string;
  target_object: string;
  target_property: string;
  note?: string;
  rule_type: 'MAP' | 'POLISH' | 'SUMMARY' | 'IGNORE';
}

const MappingDialog = ({ open, onOpenChange, migrationId }: MappingDialogProps) => {
  const [loading, setLoading] = useState(true);
  const [sourceEntities, setSourceEntities] = useState<Entity[]>([]);
  const [targetEntities, setTargetEntities] = useState<Entity[]>([]);
  const [sourceSystemName, setSourceSystemName] = useState("Source");
  const [targetSystemName, setTargetSystemName] = useState("Target");
  
  const [currentSourceIdx, setCurrentSourceIdx] = useState(0);
  const [currentTargetIdx, setCurrentTargetIdx] = useState(0);
  
  const [mappings, setMappings] = useState<MappingTuple[]>([]);
  const [mappingRules, setMappingRules] = useState<MappingRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingIgnore, setIsTogglingIgnore] = useState(false);

  // Field selection for rule creation (Rule Focus)
  const [selectedSourceFieldId, setSelectedSourceFieldId] = useState<string | null>(null);
  const [selectedTargetFieldId, setSelectedTargetFieldId] = useState<string | null>(null);

  // Editing State
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState("");

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const bottomSpacerRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const prevMessageCountRef = useRef(0);

  // Fetch migration, specs and then existing results
  useEffect(() => {
    const fetchData = async () => {
      if (!open) return;
      setLoading(true);
      try {
        const { data: migration } = await databaseClient.fetchMigrationById(migrationId);
        if (!migration) throw new Error("Migration not found");

        setSourceSystemName(migration.source_system);
        setTargetSystemName(migration.target_system);

        const [sourceSpecsRes, targetSpecsRes, resultsRes] = await Promise.all([
          databaseClient.fetchObjectSpecs(migration.source_system),
          databaseClient.fetchObjectSpecs(migration.target_system),
          databaseClient.fetchMigrationResults(migrationId)
        ]);

        const sSpecs = sourceSpecsRes.data;
        const tSpecs = targetSpecsRes.data;
        const results = resultsRes.data;

        // Inventory results from Step 3 containing ignore status
        const inventoryResults = results?.step_3 || [];

        if (sSpecs?.objects) {
          setSourceEntities(sSpecs.objects.map((obj: any) => {
            const inventoryItem = inventoryResults.find((r: any) => r.entity_name === obj.key || r.entity_name === obj.displayName);
            return {
              id: obj.key,
              name: obj.displayName || obj.key,
              isIgnored: inventoryItem?.is_ignored || false,
              fields: (obj.fields || []).map((f: any) => ({
                id: f.id,
                name: f.name || f.id,
                type: f.type || "text"
              }))
            };
          }));
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

        if (results?.step_6?.[0]?.raw_json?.mappings) {
          setMappings(results.step_6[0].raw_json.mappings);
        } else if (results?.step_5?.[0]?.raw_json?.mappings) {
          setMappings(results.step_5[0].raw_json.mappings);
        }

        const rulesResponse = await fetch(`/api/migrations/${migrationId}/mapping-rules`);
        if (rulesResponse.ok) {
            const rules = await rulesResponse.json();
            setMappingRules(rules);
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

  // Chat Fetching Logic
  useEffect(() => {
    if (!open) return;
    let isActive = true;
    setChatMessages([]);
    prevMessageCountRef.current = 0;

    const fetchChatMessages = async () => {
      try {
        const response = await fetch(`/api/migrations/${migrationId}/mapping-chat?t=${Date.now()}`);
        if (!isActive) return;
        const data = await response.json();
        setChatMessages(data);
      } catch (error) {
        console.error("Failed to fetch chat messages:", error);
      }
    };

    const fetchRules = async () => {
        try {
            const response = await fetch(`/api/migrations/${migrationId}/mapping-rules`);
            if (!isActive) return;
            if (response.ok) {
                const rules = await response.json();
                setMappingRules(rules);
            }
        } catch (error) {
            console.error("Failed to fetch rules:", error);
        }
    };

    fetchChatMessages();
    fetchRules();
    const interval = setInterval(() => {
      if (isActive) {
        fetchChatMessages();
        fetchRules();
      }
    }, 3000);

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [open, migrationId]);

  const handleScroll = () => {
    if (chatScrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = chatScrollRef.current;
      setIsNearBottom(scrollHeight - scrollTop - clientHeight < 150);
    }
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (bottomSpacerRef.current) {
        bottomSpacerRef.current.scrollIntoView({ behavior, block: 'end' });
    } else if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    const newMessageCount = chatMessages.length;
    if (newMessageCount > prevMessageCountRef.current) {
        setTimeout(() => scrollToBottom('smooth'), 100);
    }
    prevMessageCountRef.current = newMessageCount;
  }, [chatMessages.length]);

  const handleSendMessage = async (message: string) => {
    try {
      await fetch(`/api/migrations/${migrationId}/mapping-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: message, role: 'user' })
      });
      setTimeout(() => scrollToBottom('smooth'), 50);
    } catch (error) {
      console.error("Failed to send message:", error);
      toast.error("Nachricht konnte nicht gesendet werden");
    }
  };

  const activeSource = sourceEntities[currentSourceIdx];
  const activeTarget = targetEntities[currentTargetIdx];

  const currentRules = useMemo(() => {
    if (!activeSource) return [];
    return mappingRules.filter(r => r.source_object === activeSource.id || r.source_object === activeSource.name);
  }, [mappingRules, activeSource]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await databaseClient.updateMigrationResult(migrationId, 6, { mappings });
      toast.success("Mapping erfolgreich gespeichert");
    } catch (error) {
      console.error("Failed to save mappings:", error);
      toast.error("Fehler beim Speichern des Mappings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRuleSelect = (ruleId: string) => {
      if (selectedRuleId === ruleId) {
          setSelectedRuleId(null);
          return;
      }

      const rule = mappingRules.find(r => r.id === ruleId);
      if (!rule) return;
      
      setSelectedRuleId(ruleId);

      const sIdx = sourceEntities.findIndex(e => e.id === rule.source_object || e.name === rule.source_object);
      const tIdx = targetEntities.findIndex(e => e.id === rule.target_object || e.name === rule.target_object);
      
      if (sIdx !== -1) setCurrentSourceIdx(sIdx);
      if (tIdx !== -1) setCurrentTargetIdx(tIdx);
  };

  const handleRuleUpdate = async (ruleId: string, payload: Partial<{ note: string, rule_type: string }>) => {
    try {
        const response = await fetch(`/api/migrations/${migrationId}/mapping-rules/${ruleId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error("Update failed");
        const updatedRule = await response.json();
        setMappingRules(prev => prev.map(r => r.id === ruleId ? updatedRule : r));
        setEditingRuleId(null);
        toast.success("Regel aktualisiert");
    } catch (error) {
        console.error("Failed to update rule:", error);
        toast.error("Fehler beim Aktualisieren der Regel");
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
        const response = await fetch(`/api/migrations/${migrationId}/mapping-rules/${ruleId}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error("Delete failed");
        
        const deletedRule = mappingRules.find(r => r.id === ruleId);
        if (deletedRule) {
            // Also remove from local mappings state to keep Step 6 in sync
            setMappings(prev => {
                return prev.map(m => {
                    if (m.sourceEntity === deletedRule.source_object && m.targetEntity === deletedRule.target_object) {
                        return {
                            ...m,
                            fieldMappings: m.fieldMappings.filter(fm => fm.sourceField !== deletedRule.source_property || fm.targetField !== deletedRule.target_property)
                        };
                    }
                    return m;
                });
            });
        }

        setMappingRules(prev => prev.filter(r => r.id !== ruleId));
        if (selectedRuleId === ruleId) setSelectedRuleId(null);
        toast.success("Regel gelöscht");
    } catch (error) {
        console.error("Failed to delete rule:", error);
        toast.error("Fehler beim Löschen der Regel");
    }
  };

  const handleCreateRule = async () => {
    if (!activeSource || !activeTarget) {
        toast.error("Wählen Sie zuerst ein Quell- und Zielobjekt aus");
        return;
    }

    if (!selectedSourceFieldId || !selectedTargetFieldId) {
        toast.error("Bitte wählen Sie zuerst Quell- und Zielfelder im Whiteboard aus");
        return;
    }

    try {
        const payload = {
            source_system: sourceSystemName,
            source_object: activeSource.id,
            source_property: selectedSourceFieldId,
            target_system: targetSystemName,
            target_object: activeTarget.id,
            target_property: selectedTargetFieldId,
            rule_type: 'MAP',
            note: ""
        };

        const response = await fetch(`/api/migrations/${migrationId}/mapping-rules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error("Creation failed");

        const newRule = await response.json();
        setMappingRules(prev => [newRule, ...prev]);
        
        // SYNC with Step 6 Mappings
        setMappings(prev => {
            const existingIdx = prev.findIndex(m => 
              m.sourceEntity === activeSource.id && m.targetEntity === activeTarget.id
            );
            if (existingIdx >= 0) {
              const updated = [...prev];
              const tuple = { ...updated[existingIdx] };
              tuple.fieldMappings = tuple.fieldMappings.filter(f => f.targetField !== selectedTargetFieldId);
              tuple.fieldMappings.push({ sourceField: selectedSourceFieldId, targetField: selectedTargetFieldId });
              updated[existingIdx] = tuple;
              return updated;
            } else {
              return [...prev, {
                sourceEntity: activeSource.id,
                targetEntity: activeTarget.id,
                fieldMappings: [{ sourceField: selectedSourceFieldId, targetField: selectedTargetFieldId }]
              }];
            }
        });

        toast.success(`Regel erstellt`);
        setSelectedSourceFieldId(null);
        setSelectedTargetFieldId(null);
        setEditingRuleId(newRule.id);
        setEditingNote("");
    } catch (error) {
        console.error("Failed to create rule:", error);
        toast.error("Fehler beim Erstellen der Regel");
    }
  };

  const handleToggleIgnore = async () => {
    if (!activeSource) return;
    setIsTogglingIgnore(true);
    try {
      const { data, error } = await databaseClient.toggleEntityIgnore(migrationId, activeSource.id);
      if (error) throw error;
      
      setSourceEntities(prev => prev.map(e => e.id === activeSource.id ? { ...e, isIgnored: data.is_ignored } : e));
      toast.success(data.is_ignored ? `Objekt "${activeSource.name}" wird nun ignoriert` : `Objekt "${activeSource.name}" wird nicht mehr ignoriert`);
    } catch (error) {
      console.error("Failed to toggle ignore:", error);
      toast.error("Fehler beim Ändern des Ignore-Status");
    } finally {
      setIsTogglingIgnore(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1600px] h-[90vh] flex flex-col p-0 overflow-hidden [&>button]:hidden bg-background border-border shadow-2xl">
        <DialogHeader className="p-6 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-primary" />
                Model Mapping
              </DialogTitle>
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
          <div className="flex-1 flex overflow-hidden">
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel defaultSize={60} minSize={50} className="flex flex-col min-h-0">
                <div className="px-4 py-2 border-b bg-muted/5 flex items-center gap-2 shrink-0">
                    <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Regel-Fokus:</span>
                    <Select value={selectedRuleId || ""} onValueChange={handleRuleSelect} disabled={mappingRules.length === 0}>
                        <SelectTrigger className="h-8 w-full max-w-[400px]">
                            <SelectValue placeholder={mappingRules.length > 0 ? "Wähle eine Regel zum Anzeigen..." : "Keine Regeln definiert"} />
                        </SelectTrigger>
                        <SelectContent>
                            {mappingRules.map(rule => (
                                <SelectItem key={rule.id} value={rule.id}>
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-[10px] h-5 min-w-[50px] justify-center">
                                            {rule.rule_type}
                                        </Badge>
                                        <div className="flex items-center gap-1 text-xs">
                                            <span className="font-semibold">{rule.source_object}.{rule.source_property}</span>
                                            <span className="text-[10px] opacity-70">({rule.source_system})</span>
                                            <ArrowLeftRight className="w-2 h-2 mx-1" />
                                            <span className="font-semibold">{rule.target_object}.{rule.target_property}</span>
                                            <span className="text-[10px] opacity-70">({rule.target_system})</span>
                                        </div>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="grid grid-cols-2 gap-px bg-border shrink-0">
                  <div className={cn(
                    "bg-background p-4 flex items-center justify-between gap-4 transition-all border-b-2",
                    activeSource && mappingRules.some(r => r.source_object === activeSource.id) ? "border-b-primary shadow-[0_4px_12px_-2px_rgba(59,130,246,0.2)]" : "border-b-transparent",
                    activeSource?.isIgnored && "opacity-60 grayscale-[0.5]"
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
                        <Database className={cn("w-4 h-4 transition-colors", activeSource && mappingRules.some(r => r.source_object === activeSource.id) ? "text-primary" : "text-muted-foreground")} />
                        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Source: {sourceSystemName}</span>
                        {activeSource && (
                          <Button 
                            variant="ghost" size="icon" className={cn("h-6 w-6 ml-1", activeSource.isIgnored ? "text-primary bg-primary/10" : "text-muted-foreground")} 
                            onClick={(e) => { e.stopPropagation(); handleToggleIgnore(); }}
                            disabled={isTogglingIgnore}
                            title={activeSource.isIgnored ? "Objekt wird ignoriert" : "Objekt ignorieren"}
                          >
                            {activeSource.isIgnored ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </Button>
                        )}
                      </div>
                      <h3 className={cn("font-bold text-lg flex items-center justify-center gap-2", activeSource?.isIgnored && "line-through text-muted-foreground")}>
                        {activeSource?.name || "Keine Entitäten"}
                        {activeSource?.isIgnored && <Badge variant="outline" className="text-[10px] h-5 bg-primary/5 text-primary border-primary/20">Ignoriert</Badge>}
                      </h3>
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
                    activeTarget && mappingRules.some(r => r.target_object === activeTarget.id) ? "border-b-emerald-500 shadow-[0_4px_12px_-2px_rgba(16,185,129,0.2)]" : "border-b-transparent"
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
                        <Target className={cn("w-4 h-4 transition-colors", activeTarget && mappingRules.some(r => r.target_object === activeTarget.id) ? "text-emerald-500" : "text-muted-foreground")} />
                        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Target: {targetSystemName}</span>
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

                <div className="flex-1 grid grid-cols-2 overflow-hidden min-h-0">
                  <div className="flex flex-col min-h-0">
                    <ScrollArea className="flex-1">
                      <div className="p-4 space-y-2">
                        {(activeSource?.fields || []).map((field) => {
                          const hasRule = mappingRules.some(r => r.source_object === activeSource.id && r.source_property === field.id);
                          const isSelectedForRule = selectedSourceFieldId === field.id;
                          
                          return (
                            <div 
                              key={field.id}
                              className={cn(
                                "group flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer shadow-sm relative",
                                hasRule 
                                  ? "bg-primary/10 border-primary ring-1 ring-primary/20 shadow-primary/5" 
                                  : "bg-card border-border hover:border-primary/50",
                                isSelectedForRule && "ring-2 ring-primary ring-offset-2 bg-primary/20 shadow-lg"
                              )}
                              onClick={() => setSelectedSourceFieldId(isSelectedForRule ? null : field.id)}
                            >
                              <div className="flex flex-col">
                                <span className={cn("text-sm font-medium transition-colors", hasRule ? "text-primary" : "text-foreground")}>{field.name}</span>
                                <span className="text-[10px] text-muted-foreground uppercase">{field.type}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                  {isSelectedForRule && <Badge className="h-4 text-[8px] px-1 bg-primary text-white">Quelle ausgewählt</Badge>}
                                  {!hasRule && <Plus className={cn("w-4 h-4 text-muted-foreground group-hover:text-primary")} />}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="flex flex-col min-h-0">
                    <ScrollArea className="flex-1">
                      <div className="p-4 space-y-3">
                        {(activeTarget && (activeTarget.fields.length === 0 ? [{id: "summary", name: "Summary"}] : activeTarget.fields)).map((fieldObj) => {
                          const field = typeof fieldObj === 'string' ? {id: fieldObj, name: fieldObj} : fieldObj;
                          const rule = mappingRules.find(r => r.target_object === activeTarget.id && r.target_property === field.id);
                          const isSelectedForRule = selectedTargetFieldId === field.id;
                          
                          return (
                            <div 
                              key={field.id}
                              className={cn(
                                "flex items-center gap-4 p-3 rounded-xl border transition-all cursor-pointer",
                                rule 
                                  ? "bg-emerald-500/10 border-emerald-500 ring-1 ring-emerald-500/20 shadow-emerald-500/5" 
                                  : "bg-card border-dashed opacity-60",
                                isSelectedForRule && "ring-2 ring-emerald-500 ring-offset-2 bg-emerald-500/20 shadow-lg opacity-100"
                              )}
                              onClick={() => {
                                  if (isSelectedForRule) {
                                      setSelectedTargetFieldId(null);
                                  } else {
                                      setSelectedTargetFieldId(field.id);
                                      if (rule) setSelectedSourceFieldId(rule.source_property);
                                  }
                              }}
                            >
                              <div className="flex-1 flex flex-col">
                                <div className="flex items-center justify-between">
                                    <span className={cn("text-sm font-semibold transition-colors", rule ? "text-emerald-600" : "text-foreground")}>{field.name}</span>
                                    {isSelectedForRule && <Badge className="h-4 text-[8px] px-1 bg-emerald-500 text-white">Ziel ausgewählt</Badge>}
                                </div>
                                {rule ? (
                                  <div className="flex items-center gap-2 mt-1">
                                    <Badge variant="secondary" className={cn("bg-emerald-500/20 text-emerald-700 border-none text-[10px] h-5 font-bold", rule.rule_type === 'IGNORE' && "bg-amber-500/20 text-amber-700")}>
                                      {rule.rule_type === 'IGNORE' ? "IGNORIERT" : rule.source_property}
                                    </Badge>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground italic">Nicht zugewiesen</span>
                                )}
                              </div>
                              {!rule && <Plus className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100" />}
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>
                </div>

                <div className="shrink-0 border-t bg-muted/5 p-4 flex flex-col gap-3 min-h-[100px] max-h-[300px] overflow-y-auto">
                    <div className="flex items-center justify-between sticky top-0 bg-muted/5 pb-2 z-10">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Regeln</span>
                            <Badge variant="outline" className="text-[10px] h-5">
                                {currentRules.length}
                            </Badge>
                            
                            <div className="flex items-center gap-2 ml-4">
                                <Button 
                                    variant={selectedSourceFieldId && selectedTargetFieldId ? "default" : "outline"}
                                    size="sm" 
                                    className={cn(
                                        "h-7 px-3 text-[10px] font-bold transition-all border-dashed",
                                        selectedSourceFieldId && selectedTargetFieldId ? "bg-primary text-white scale-105 border-solid" : "text-muted-foreground"
                                    )}
                                    onClick={handleCreateRule}
                                >
                                    <Plus className="w-3 h-3 mr-1" />
                                    Regel erstellen {selectedSourceFieldId && selectedTargetFieldId && `(${selectedSourceFieldId} → ${selectedTargetFieldId})`}
                                </Button>
                                {!(selectedSourceFieldId && selectedTargetFieldId) && (
                                    <span className="text-[9px] text-muted-foreground animate-pulse">Klicke Felder oben an, um den Fokus zu setzen</span>
                                )}
                            </div>
                        </div>
                    </div>
                    
                    {currentRules.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            {currentRules.map(rule => (
                                <div 
                                    key={rule.id} 
                                    className={cn(
                                        "p-2 rounded border flex flex-col gap-1 group/rule border-l-4 transition-all cursor-pointer",
                                        selectedRuleId === rule.id 
                                            ? "bg-primary/5 border-primary border-l-primary shadow-sm" 
                                            : "bg-background/50 border-border border-l-primary/30 hover:bg-muted/20"
                                    )}
                                    onClick={() => handleRuleSelect(rule.id)}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-sm">
                                            <div className="flex items-center gap-1">
                                                <span className={cn("font-bold text-foreground", rule.rule_type === 'IGNORE' && "line-through opacity-50")}>
                                                    {rule.source_object}.<span className="text-primary">{rule.source_property}</span>
                                                </span>
                                                <span className="text-[10px] text-muted-foreground font-medium">({rule.source_system})</span>
                                            </div>
                                            <ArrowLeftRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                            <div className="flex items-center gap-1">
                                                <span className="font-bold text-foreground">
                                                    {rule.target_object}.<span className="text-emerald-600">{rule.target_property}</span>
                                                </span>
                                                <span className="text-[10px] text-muted-foreground font-medium">({rule.target_system})</span>
                                            </div>
                                        </div>
                                        
                                        <div className="flex items-center gap-2">
                                            <Select 
                                                value={rule.rule_type} 
                                                onValueChange={(val) => handleRuleUpdate(rule.id, { rule_type: val as any })}
                                            >
                                                <SelectTrigger 
                                                    className={cn(
                                                      "h-6 w-auto min-w-[80px] text-[10px] px-2 bg-transparent border-none shadow-none font-bold",
                                                      rule.rule_type === 'IGNORE' && "text-amber-600"
                                                    )}
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="MAP" className="text-[10px]">MAP</SelectItem>
                                                    <SelectItem value="POLISH" className="text-[10px]">POLISH</SelectItem>
                                                    <SelectItem value="SUMMARY" className="text-[10px]">SUMMARY</SelectItem>
                                                    <SelectItem value="IGNORE" className="text-[10px] text-amber-600 font-bold">IGNORE</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <Button 
                                                size="icon" variant="ghost" 
                                                className="h-6 w-6 text-muted-foreground hover:text-destructive opacity-0 group-hover/rule:opacity-100 transition-opacity"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteRule(rule.id);
                                                }}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                    
                                    <div className="flex items-start gap-2 min-h-[20px]">
                                        {editingRuleId === rule.id ? (
                                            <div className="flex-1 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                                <Input 
                                                    value={editingNote} 
                                                    onChange={(e) => setEditingNote(e.target.value)}
                                                    className="h-7 text-xs"
                                                    autoFocus
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleRuleUpdate(rule.id, { note: editingNote });
                                                        if (e.key === 'Escape') setEditingRuleId(null);
                                                    }}
                                                />
                                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleRuleUpdate(rule.id, { note: editingNote })}>
                                                    <Check className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="flex-1 flex items-center justify-between group/note">
                                                <span className="text-xs text-muted-foreground italic truncate">
                                                    {rule.note ? `"${rule.note}"` : "Keine Notiz vorhanden."}
                                                </span>
                                                <Button 
                                                    size="icon" variant="ghost" 
                                                    className="h-6 w-6 opacity-0 group-hover/rule:opacity-100 transition-opacity"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditingRuleId(rule.id);
                                                        setEditingNote(rule.note || "");
                                                    }}
                                                >
                                                    <Pencil className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center py-4 text-xs text-muted-foreground italic">
                            Keine Regeln für dieses Quell-Objekt vorhanden.
                        </div>
                    )}
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize={40} maxSize={50} minSize={25} className="flex flex-col min-h-0 bg-muted/10">
                 <div className="px-4 py-3 bg-background/50 flex items-center gap-2 shrink-0">
                  <MessageSquare className="w-4 h-4 text-primary" />
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Mapping Assistent</span>
                </div>
                <div className="flex-1 relative min-h-0">
                   <div ref={chatScrollRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto px-4 py-4 scroll-smooth">
                      <ChatMessageList 
                        messages={chatMessages} 
                        isAgentRunning={false} 
                      />
                      <div ref={bottomSpacerRef} className="h-2" />
                   </div>
                </div>
                <div className="p-4 bg-background">
                  <ChatInput 
                    onSend={handleSendMessage} 
                    placeholder="Fragen zum Mapping stellen..."
                    disabled={false}
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default MappingDialog;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1600px] h-[90vh] flex flex-col p-0 overflow-hidden [&>button]:hidden bg-background border-border shadow-2xl">
        <DialogHeader className="p-6 border-b shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-primary" />
                Model Mapping
              </DialogTitle>
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
          <div className="flex-1 flex overflow-hidden">
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel defaultSize={60} minSize={50} className="flex flex-col min-h-0">
                <div className="px-4 py-2 border-b bg-muted/5 flex items-center gap-2 shrink-0">
                    <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">Regel-Fokus:</span>
                    <Select value={selectedRuleId || ""} onValueChange={handleRuleSelect} disabled={mappingRules.length === 0}>
                        <SelectTrigger className="h-8 w-full max-w-[400px]">
                            <SelectValue placeholder={mappingRules.length > 0 ? "Wähle eine Regel zum Anzeigen..." : "Keine Regeln definiert"} />
                        </SelectTrigger>
                        <SelectContent>
                            {mappingRules.map(rule => (
                                <SelectItem key={rule.id} value={rule.id}>
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-[10px] h-5 min-w-[50px] justify-center">
                                            {rule.rule_type}
                                        </Badge>
                                        <div className="flex items-center gap-1 text-xs">
                                            <span className="font-semibold">{rule.source_object}.{rule.source_property}</span>
                                            <span className="text-[10px] opacity-70">({rule.source_system})</span>
                                            <ArrowLeftRight className="w-2 h-2 mx-1" />
                                            <span className="font-semibold">{rule.target_object}.{rule.target_property}</span>
                                            <span className="text-[10px] opacity-70">({rule.target_system})</span>
                                        </div>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="grid grid-cols-2 gap-px bg-border shrink-0">
                  <div className={cn(
                    "bg-background p-4 flex items-center justify-between gap-4 transition-all border-b-2",
                    activeSource && mappingRules.some(r => r.source_object === activeSource.id) ? "border-b-primary shadow-[0_4px_12px_-2px_rgba(59,130,246,0.2)]" : "border-b-transparent"
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
                        <Database className={cn("w-4 h-4 transition-colors", activeSource && mappingRules.some(r => r.source_object === activeSource.id) ? "text-primary" : "text-muted-foreground")} />
                        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Source: {sourceSystemName}</span>
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
                    activeTarget && mappingRules.some(r => r.target_object === activeTarget.id) ? "border-b-emerald-500 shadow-[0_4px_12px_-2px_rgba(16,185,129,0.2)]" : "border-b-transparent"
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
                        <Target className={cn("w-4 h-4 transition-colors", activeTarget && mappingRules.some(r => r.target_object === activeTarget.id) ? "text-emerald-500" : "text-muted-foreground")} />
                        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Target: {targetSystemName}</span>
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

                <div className="flex-1 grid grid-cols-2 overflow-hidden min-h-0">
                  <div className="flex flex-col min-h-0">
                    <ScrollArea className="flex-1">
                      <div className="p-4 space-y-2">
                        {(activeSource?.fields || []).map((field) => {
                          const hasRule = mappingRules.some(r => r.source_object === activeSource.id && r.source_property === field.id);
                          const isSelectedForRule = selectedSourceFieldId === field.id;
                          
                          return (
                            <div 
                              key={field.id}
                              className={cn(
                                "group flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer shadow-sm relative",
                                hasRule 
                                  ? "bg-primary/10 border-primary ring-1 ring-primary/20 shadow-primary/5" 
                                  : "bg-card border-border hover:border-primary/50",
                                isSelectedForRule && "ring-2 ring-primary ring-offset-2 bg-primary/20 shadow-lg"
                              )}
                              onClick={() => setSelectedSourceFieldId(isSelectedForRule ? null : field.id)}
                            >
                              <div className="flex flex-col">
                                <span className={cn("text-sm font-medium transition-colors", hasRule ? "text-primary" : "text-foreground")}>{field.name}</span>
                                <span className="text-[10px] text-muted-foreground uppercase">{field.type}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                  {isSelectedForRule && <Badge className="h-4 text-[8px] px-1 bg-primary text-white">Quelle ausgewählt</Badge>}
                                  {!hasRule && <Plus className={cn("w-4 h-4 text-muted-foreground group-hover:text-primary")} />}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="flex flex-col min-h-0">
                    <ScrollArea className="flex-1">
                      <div className="p-4 space-y-3">
                        {(activeTarget && (activeTarget.fields.length === 0 ? [{id: "summary", name: "Summary"}] : activeTarget.fields)).map((fieldObj) => {
                          const field = typeof fieldObj === 'string' ? {id: fieldObj, name: fieldObj} : fieldObj;
                          const rule = mappingRules.find(r => r.target_object === activeTarget.id && r.target_property === field.id);
                          const isSelectedForRule = selectedTargetFieldId === field.id;
                          
                          return (
                            <div 
                              key={field.id}
                              className={cn(
                                "flex items-center gap-4 p-3 rounded-xl border transition-all cursor-pointer",
                                rule 
                                  ? "bg-emerald-500/10 border-emerald-500 ring-1 ring-emerald-500/20 shadow-emerald-500/5" 
                                  : "bg-card border-dashed opacity-60",
                                isSelectedForRule && "ring-2 ring-emerald-500 ring-offset-2 bg-emerald-500/20 shadow-lg opacity-100"
                              )}
                              onClick={() => {
                                  if (isSelectedForRule) {
                                      setSelectedTargetFieldId(null);
                                  } else {
                                      setSelectedTargetFieldId(field.id);
                                      if (rule) setSelectedSourceFieldId(rule.source_property);
                                  }
                              }}
                            >
                              <div className="flex-1 flex flex-col">
                                <div className="flex items-center justify-between">
                                    <span className={cn("text-sm font-semibold transition-colors", rule ? "text-emerald-600" : "text-foreground")}>{field.name}</span>
                                    {isSelectedForRule && <Badge className="h-4 text-[8px] px-1 bg-emerald-500 text-white">Ziel ausgewählt</Badge>}
                                </div>
                                {rule ? (
                                  <div className="flex items-center gap-2 mt-1">
                                    <Badge variant="secondary" className="bg-emerald-500/20 text-emerald-700 border-none text-[10px] h-5 font-bold">
                                      {rule.source_property}
                                    </Badge>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground italic">Nicht zugewiesen</span>
                                )}
                              </div>
                              {!rule && <Plus className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100" />}
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>
                </div>

                <div className="shrink-0 border-t bg-muted/5 p-4 flex flex-col gap-3 min-h-[100px] max-h-[300px] overflow-y-auto">
                    <div className="flex items-center justify-between sticky top-0 bg-muted/5 pb-2 z-10">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Regeln</span>
                            <Badge variant="outline" className="text-[10px] h-5">
                                {currentRules.length}
                            </Badge>
                            
                            <div className="flex items-center gap-2 ml-4">
                                <Button 
                                    variant={selectedSourceFieldId && selectedTargetFieldId ? "default" : "outline"}
                                    size="sm" 
                                    className={cn(
                                        "h-7 px-3 text-[10px] font-bold transition-all border-dashed",
                                        selectedSourceFieldId && selectedTargetFieldId ? "bg-primary text-white scale-105 border-solid" : "text-muted-foreground"
                                    )}
                                    onClick={handleCreateRule}
                                >
                                    <Plus className="w-3 h-3 mr-1" />
                                    Regel erstellen {selectedSourceFieldId && selectedTargetFieldId && `(${selectedSourceFieldId} → ${selectedTargetFieldId})`}
                                </Button>
                                {!(selectedSourceFieldId && selectedTargetFieldId) && (
                                    <span className="text-[9px] text-muted-foreground animate-pulse">Klicke Felder oben an, um den Fokus zu setzen</span>
                                )}
                            </div>
                        </div>
                    </div>
                    
                    {currentRules.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            {currentRules.map(rule => (
                                <div 
                                    key={rule.id} 
                                    className={cn(
                                        "p-2 rounded border flex flex-col gap-1 group/rule border-l-4 transition-all cursor-pointer",
                                        selectedRuleId === rule.id 
                                            ? "bg-primary/5 border-primary border-l-primary shadow-sm" 
                                            : "bg-background/50 border-border border-l-primary/30 hover:bg-muted/20"
                                    )}
                                    onClick={() => handleRuleSelect(rule.id)}
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-sm">
                                            <div className="flex items-center gap-1">
                                                <span className="font-bold text-foreground">
                                                    {rule.source_object}.<span className="text-primary">{rule.source_property}</span>
                                                </span>
                                                <span className="text-[10px] text-muted-foreground font-medium">({rule.source_system})</span>
                                            </div>
                                            <ArrowLeftRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                            <div className="flex items-center gap-1">
                                                <span className="font-bold text-foreground">
                                                    {rule.target_object}.<span className="text-emerald-600">{rule.target_property}</span>
                                                </span>
                                                <span className="text-[10px] text-muted-foreground font-medium">({rule.target_system})</span>
                                            </div>
                                        </div>
                                        
                                        <div className="flex items-center gap-2">
                                            <Select 
                                                value={rule.rule_type} 
                                                onValueChange={(val) => handleRuleUpdate(rule.id, { rule_type: val as any })}
                                            >
                                                <SelectTrigger 
                                                    className="h-6 w-auto min-w-[80px] text-[10px] px-2 bg-transparent border-none shadow-none font-bold"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="MAP" className="text-[10px]">MAP</SelectItem>
                                                    <SelectItem value="POLISH" className="text-[10px]">POLISH</SelectItem>
                                                    <SelectItem value="SUMMARY" className="text-[10px]">SUMMARY</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <Button 
                                                size="icon" variant="ghost" 
                                                className="h-6 w-6 text-muted-foreground hover:text-destructive opacity-0 group-hover/rule:opacity-100 transition-opacity"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteRule(rule.id);
                                                }}
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                    
                                    <div className="flex items-start gap-2 min-h-[20px]">
                                        {editingRuleId === rule.id ? (
                                            <div className="flex-1 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                                <Input 
                                                    value={editingNote} 
                                                    onChange={(e) => setEditingNote(e.target.value)}
                                                    className="h-7 text-xs"
                                                    autoFocus
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleRuleUpdate(rule.id, { note: editingNote });
                                                        if (e.key === 'Escape') setEditingRuleId(null);
                                                    }}
                                                />
                                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleRuleUpdate(rule.id, { note: editingNote })}>
                                                    <Check className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="flex-1 flex items-center justify-between group/note">
                                                <span className="text-xs text-muted-foreground italic truncate">
                                                    {rule.note ? `"${rule.note}"` : "Keine Notiz vorhanden."}
                                                </span>
                                                <Button 
                                                    size="icon" variant="ghost" 
                                                    className="h-6 w-6 opacity-0 group-hover/rule:opacity-100 transition-opacity"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditingRuleId(rule.id);
                                                        setEditingNote(rule.note || "");
                                                    }}
                                                >
                                                    <Pencil className="w-3 h-3" />
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="flex items-center justify-center py-4 text-xs text-muted-foreground italic">
                            Keine Regeln für dieses Quell-Objekt vorhanden.
                        </div>
                    )}
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize={40} maxSize={50} minSize={25} className="flex flex-col min-h-0 bg-muted/10">
                 <div className="px-4 py-3 bg-background/50 flex items-center gap-2 shrink-0">
                  <MessageSquare className="w-4 h-4 text-primary" />
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Mapping Assistent</span>
                </div>
                <div className="flex-1 relative min-h-0">
                   <div ref={chatScrollRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto px-4 py-4 scroll-smooth">
                      <ChatMessageList 
                        messages={chatMessages} 
                        isAgentRunning={false} 
                      />
                      <div ref={bottomSpacerRef} className="h-2" />
                   </div>
                </div>
                <div className="p-4 bg-background">
                  <ChatInput 
                    onSend={handleSendMessage} 
                    placeholder="Fragen zum Mapping stellen..."
                    disabled={false}
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default MappingDialog;