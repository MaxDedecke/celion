import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Database,
  Sparkles,
  Save,
  Loader2,
  MessageSquare,
  Pencil,
  Check,
  Zap
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface EnhancementPanelProps {
  migrationId: string;
  onClose?: () => void;
  onTriggerStep?: () => void;
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

interface MappingRule {
  id: string;
  source_system: string;
  source_object: string;
  source_property: string;
  target_system: string;
  target_object: string;
  target_property: string;
  note?: string;
  rule_type: string;
}

const ENHANCEMENT_TYPES = [
  { id: "spellcheck", name: "Rechtschreibprüfung", description: "Prüft und korrigiert Rechtschreibung und Grammatik." },
  { id: "tone_check", name: "Tonalität anpassen", description: "Passt den Text an eine professionelle Tonalität an." },
  { id: "summarize", name: "Zusammenfassen", description: "Erstellt eine prägnante Zusammenfassung des Inhalts." },
  { id: "pii_redact", name: "PII Schwärzung", description: "Entfernt personenbezogene Daten automatisch." },
  { id: "translate_en", name: "Übersetzung (-> EN)", description: "Übersetzt den Text ins Englische." },
  { id: "sentiment", name: "Sentiment Analyse", description: "Analysiert die Stimmung des Textes." },
];

const EnhancementPanel = ({ migrationId, onClose, onTriggerStep }: EnhancementPanelProps) => {
  const [loading, setLoading] = useState(true);
  const [sourceEntities, setSourceEntities] = useState<Entity[]>([]);
  const [sourceSystemName, setSourceSystemName] = useState("Source");
  
  const [currentSourceIdx, setCurrentSourceIdx] = useState(0);
  
  const [mappingRules, setMappingRules] = useState<MappingRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // Field selection for rule creation
  const [selectedSourceFieldId, setSelectedSourceFieldId] = useState<string | null>(null);
  const [selectedEnhancementId, setSelectedEnhancementId] = useState<string | null>(null);

  // Editing State
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState("");

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatLoaded, setIsChatLoaded] = useState(false);
  const welcomeCheckedRef = useRef(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const bottomSpacerRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const prevMessageCountRef = useRef(0);

  // Fetch migration, specs and then existing results
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const { data: migration } = await databaseClient.fetchMigrationById(migrationId);
        if (!migration) throw new Error("Migration not found");

        setSourceSystemName(migration.source_system);

        const [sourceSpecsRes, resultsRes] = await Promise.all([
          databaseClient.fetchObjectSpecs(migration.source_system),
          databaseClient.fetchMigrationResults(migrationId)
        ]);

        const sSpecs = sourceSpecsRes.data;
        const results = resultsRes.data;

        const inventoryResults = results?.step_3 || [];

        if (sSpecs?.objects) {
          setSourceEntities(sSpecs.objects
            .filter((obj: any) => {
                const inventoryItem = inventoryResults.find((r: any) => r.entity_name === obj.key || r.entity_name === obj.displayName);
                return !inventoryItem?.is_ignored;
            })
            .map((obj: any) => ({
              id: obj.key,
              name: obj.displayName || obj.key,
              fields: (obj.fields || []).map((f: any) => ({
                id: f.id,
                name: f.name || f.id,
                type: f.type || "text"
              }))
            })));
        }

        const rulesResponse = await fetch(`/api/migrations/${migrationId}/mapping-rules`);
        if (rulesResponse.ok) {
            const rules: MappingRule[] = await rulesResponse.json();
            setMappingRules(rules);
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [migrationId]);

  // Chat Fetching Logic
  useEffect(() => {
    let isActive = true;
    
    const fetchChatMessages = async () => {
      try {
        const response = await fetch(`/api/migrations/${migrationId}/mapping-chat?t=${Date.now()}`);
        if (!isActive) return;
        const data = await response.json();
        setChatMessages(data);
        setIsChatLoaded(true);
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

    // Reset for new migration
    setChatMessages([]);
    setIsChatLoaded(false);
    welcomeCheckedRef.current = false;
    prevMessageCountRef.current = 0;

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
  }, [migrationId]);

  // Initial Welcome Message
  useEffect(() => {
    if (isChatLoaded && !welcomeCheckedRef.current) {
        welcomeCheckedRef.current = true;
        if (chatMessages.length === 0) {
            const sendWelcome = async () => {
                try {
                  await fetch(`/api/migrations/${migrationId}/mapping-chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                      content: "Willkommen im Enhancement-Editor! Hier kannst du festlegen, wie deine Daten während der Migration optimiert werden sollen, z. B. durch Rechtschreibprüfung oder automatische Zusammenfassungen.", 
                      role: 'assistant' 
                    })
                  });
                  
                  const response = await fetch(`/api/migrations/${migrationId}/mapping-chat?t=${Date.now()}`);
                  if (response.ok) {
                    const data = await response.json();
                    setChatMessages(data);
                  }
                } catch (error) {
                  console.error("Failed to send welcome message:", error);
                }
            };
            sendWelcome();
        }
    }
  }, [isChatLoaded, migrationId, chatMessages.length]);

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

  const currentRules = useMemo(() => {
    if (!activeSource) return [];
    return mappingRules.filter(r => 
        (r.source_object === activeSource.id || r.source_object === activeSource.name) && 
        (r.rule_type === 'ENHANCE' || r.rule_type === 'POLISH' || r.rule_type === 'SUMMARY')
    );
  }, [mappingRules, activeSource]);

  const handleSaveClick = () => {
    setShowSaveDialog(true);
  };

  const handleConfirmSave = async () => {
    setShowSaveDialog(false);
    setIsSaving(true);
    try {
      // Step 7 trigger
      await fetch(`/api/migrations/${migrationId}/action/7`, { method: 'POST' });
      toast.success("Enhancements erfolgreich gespeichert");
      onTriggerStep?.();
      onClose?.();
    } catch (error) {
      console.error("Failed to save enhancements:", error);
      toast.error("Fehler beim Speichern der Enhancements");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelSave = () => {
    setShowSaveDialog(false);
    onClose?.();
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
      if (sIdx !== -1) setCurrentSourceIdx(sIdx);
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
        toast.success("Enhancement aktualisiert");
    } catch (error) {
        console.error("Failed to update rule:", error);
        toast.error("Fehler beim Aktualisieren des Enhancements");
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
        const response = await fetch(`/api/migrations/${migrationId}/mapping-rules/${ruleId}`, {
            method: 'DELETE'
        });
        if (!response.ok) throw new Error("Delete failed");
        
        setMappingRules(prev => prev.filter(r => r.id !== ruleId));
        if (selectedRuleId === ruleId) setSelectedRuleId(null);
        toast.success("Enhancement gelöscht");
    } catch (error) {
        console.error("Failed to delete rule:", error);
        toast.error("Fehler beim Löschen des Enhancements");
    }
  };

  const handleCreateRule = async () => {
    if (!activeSource) {
        toast.error("Wählen Sie zuerst ein Quellobjekt aus");
        return;
    }

    if (!selectedSourceFieldId || !selectedEnhancementId) {
        toast.error("Bitte wählen Sie zuerst ein Quellfeld und ein Enhancement aus");
        return;
    }

    try {
        const enhancement = ENHANCEMENT_TYPES.find(e => e.id === selectedEnhancementId);
        const payload = {
            source_system: sourceSystemName,
            source_object: activeSource.id,
            source_property: selectedSourceFieldId,
            target_system: "ENHANCEMENT",
            target_object: "QUALITY",
            target_property: selectedEnhancementId,
            rule_type: 'ENHANCE',
            note: enhancement?.name || ""
        };

        const response = await fetch(`/api/migrations/${migrationId}/mapping-rules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error("Creation failed");

        const newRule = await response.json();
        setMappingRules(prev => [newRule, ...prev]);
        
        toast.success(`Enhancement erstellt`);
        setSelectedSourceFieldId(null);
        setSelectedEnhancementId(null);
        setEditingRuleId(newRule.id);
        setEditingNote(newRule.note || "");
    } catch (error) {
        console.error("Failed to create rule:", error);
        toast.error("Fehler beim Erstellen des Enhancements");
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-12 h-12 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground font-medium animate-pulse">Lade Enhancements...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
        <div className="p-4 border-b flex items-center justify-between shrink-0 gap-4">
            <div className="flex items-center gap-4 flex-1">
                <h2 className="font-bold text-sm uppercase tracking-wider text-muted-foreground whitespace-nowrap">Quality Enhancements</h2>
                
                <div className="h-4 w-px bg-border hidden sm:block" />
                
                <div className="flex items-center gap-2 flex-1 max-w-md">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground whitespace-nowrap">Fokus:</span>
                    <Select value={selectedRuleId || ""} onValueChange={handleRuleSelect} disabled={currentRules.length === 0}>
                        <SelectTrigger className="h-8 w-full bg-muted/30 border-none shadow-none text-xs font-medium">
                            <SelectValue placeholder={currentRules.length > 0 ? "Enhancement auswählen..." : "Keine Enhancements"} />
                        </SelectTrigger>
                        <SelectContent>
                            {currentRules.map(rule => (
                                <SelectItem key={rule.id} value={rule.id}>
                                    <div className="flex items-center gap-2">
                                        <Badge variant="outline" className="text-[9px] h-4 min-w-[45px] justify-center px-1">
                                            {rule.target_property}
                                        </Badge>
                                        <div className="flex items-center gap-1 text-[11px]">
                                            <span className="font-semibold">{rule.source_object}.{rule.source_property}</span>
                                        </div>
                                    </div>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleSaveClick} disabled={isSaving} className="h-8 text-xs min-w-[100px]">
                    {isSaving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
                    Fertigstellen
                </Button>
            </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel defaultSize={60} minSize={50} className="flex flex-col min-h-0">
                <div className="grid grid-cols-2 shrink-0">
                  <div className={cn(
                    "bg-background p-4 flex items-center justify-between gap-4 transition-all border-b",
                    activeSource && currentRules.some(r => r.source_object === activeSource.id) ? "border-b-primary shadow-[0_2px_8px_-2px_rgba(59,130,246,0.1)]" : "border-b-border"
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
                        <Database className={cn("w-4 h-4 transition-colors", activeSource && currentRules.some(r => r.source_object === activeSource.id) ? "text-primary" : "text-muted-foreground")} />
                        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Source: {sourceSystemName}</span>
                      </div>
                      <h3 className="font-bold text-lg">
                        {activeSource?.name || "Keine Entitäten"}
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

                  <div className="bg-background p-4 flex items-center justify-between gap-4 transition-all border-b border-b-primary shadow-[0_2px_8px_-2px_rgba(59,130,246,0.1)]">
                    <div className="flex-1 text-center">
                      <div className="flex items-center justify-center gap-2 mb-1">
                        <Sparkles className="w-4 h-4 text-primary" />
                        <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Verfügbare Enhancements</span>
                      </div>
                      <h3 className="font-bold text-lg">Optimierungen</h3>
                    </div>
                  </div>
                </div>

                <div className="flex-1 grid grid-cols-2 overflow-hidden min-h-0">
                  <div className="flex flex-col min-h-0 border-r">
                    <ScrollArea className="flex-1">
                      <div className="p-4 space-y-2">
                        {(activeSource?.fields || []).map((field) => {
                          const hasRule = currentRules.some(r => r.source_object === activeSource.id && r.source_property === field.id);
                          const isSelected = selectedSourceFieldId === field.id;
                          
                          return (
                            <div 
                              key={field.id}
                              className={cn(
                                "group flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer shadow-sm",
                                hasRule 
                                  ? "bg-primary/10 border-primary ring-1 ring-primary/20 shadow-primary/5" 
                                  : "bg-card border-border hover:border-primary/50",
                                isSelected && "ring-2 ring-primary ring-offset-2 bg-primary/20 shadow-lg"
                              )}
                              onClick={() => setSelectedSourceFieldId(isSelected ? null : field.id)}
                            >
                              <div className="flex flex-col">
                                <span className={cn("text-sm font-medium transition-colors", hasRule ? "text-primary" : "text-foreground")}>{field.name}</span>
                                <span className="text-[10px] text-muted-foreground uppercase">{field.type}</span>
                              </div>
                              {isSelected && <Badge className="h-4 text-[8px] px-1 bg-primary text-white">Feld ausgewählt</Badge>}
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="flex flex-col min-h-0">
                    <ScrollArea className="flex-1">
                      <div className="p-4 space-y-3">
                        {ENHANCEMENT_TYPES.map((enhancement) => {
                          const rule = currentRules.find(r => r.source_object === activeSource.id && r.source_property === selectedSourceFieldId && r.target_property === enhancement.id);
                          const isSelected = selectedEnhancementId === enhancement.id;
                          
                          return (
                            <div 
                              key={enhancement.id}
                              className={cn(
                                "flex items-center gap-4 p-3 rounded-xl border transition-all cursor-pointer group",
                                rule 
                                  ? "bg-emerald-500/10 border-emerald-500 ring-1 ring-emerald-500/20 shadow-emerald-500/5" 
                                  : "bg-card border-dashed hover:border-primary/30",
                                isSelected && "ring-2 ring-primary ring-offset-2 bg-primary/10 shadow-lg opacity-100"
                              )}
                              onClick={() => setSelectedEnhancementId(isSelected ? null : enhancement.id)}
                            >
                              <div className="flex-1 flex flex-col">
                                <div className="flex items-center justify-between">
                                    <span className={cn("text-sm font-semibold transition-colors", rule ? "text-emerald-600" : "text-foreground")}>{enhancement.name}</span>
                                    {isSelected && <Badge className="h-4 text-[8px] px-1 bg-primary text-white">Aktiviert</Badge>}
                                </div>
                                <span className="text-[10px] text-muted-foreground mt-0.5">{enhancement.description}</span>
                              </div>
                              <Plus className={cn("w-4 h-4 text-muted-foreground transition-opacity", isSelected || rule ? "opacity-0" : "opacity-0 group-hover:opacity-100")} />
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>
                </div>

                <div className="shrink-0 bg-muted/5 p-4 flex flex-col gap-3 min-h-[100px] max-h-[300px] overflow-y-auto">
                    <div className="flex items-center justify-between sticky top-0 bg-muted/5 pb-2 z-10">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Konfigurierte Enhancements</span>
                            <Badge variant="outline" className="text-[10px] h-5">
                                {currentRules.length}
                            </Badge>
                            
                            <div className="flex items-center gap-2 ml-4">
                                <Button 
                                    variant={selectedSourceFieldId && selectedEnhancementId ? "default" : "outline"}
                                    size="sm" 
                                    className={cn(
                                        "h-7 px-3 text-[10px] font-bold transition-all border-dashed",
                                        selectedSourceFieldId && selectedEnhancementId ? "bg-primary text-white scale-105 border-solid" : "text-muted-foreground"
                                    )}
                                    onClick={handleCreateRule}
                                >
                                    <Zap className="w-3 h-3 mr-1" />
                                    Hinzufügen {selectedSourceFieldId && selectedEnhancementId && `(${selectedSourceFieldId} → ${selectedEnhancementId})`}
                                </Button>
                                {!(selectedSourceFieldId && selectedEnhancementId) && (
                                    <span className="text-[9px] text-muted-foreground animate-pulse">Wähle links ein Feld und rechts eine Optimierung</span>
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
                                            </div>
                                            <ArrowLeftRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                            <div className="flex items-center gap-1">
                                                <span className="font-bold text-emerald-600 uppercase text-[10px] tracking-widest">
                                                    {rule.target_property}
                                                </span>
                                            </div>
                                        </div>
                                        
                                        <div className="flex items-center gap-2">
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
                            Keine Enhancements für dieses Objekt konfiguriert.
                        </div>
                    )}
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize={40} maxSize={50} minSize={25} className="flex flex-col min-h-0 bg-muted/10">
                 <div className="px-4 py-3 bg-background/50 flex items-center gap-2 shrink-0">
                  <MessageSquare className="w-4 h-4 text-primary" />
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Enhancement Assistent</span>
                </div>
                <div className="flex-1 relative min-h-0">
                   <div ref={chatScrollRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto px-4 py-4 scroll-smooth">
                      <ChatMessageList 
                        messages={chatMessages} 
                        isAgentRunning={chatMessages.length > 0 && chatMessages[chatMessages.length - 1].role === 'user'} 
                      />
                      <div ref={bottomSpacerRef} className="h-2" />
                   </div>
                </div>
                <div className="p-4 bg-background">
                  <div className="flex justify-end mb-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="text-xs h-7 gap-1.5 text-primary border-primary/20 hover:bg-primary/5"
                      onClick={() => handleSendMessage("Schlage mir passende Optimierungen für die aktuellen Felder vor.")}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Vorschläge anfordern
                    </Button>
                  </div>
                  <ChatInput 
                    onSend={handleSendMessage} 
                    placeholder="Fragen zu Optimierungen stellen..."
                    disabled={false}
                  />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>

          <AlertDialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Konfiguration abschließen?</AlertDialogTitle>
                <AlertDialogDescription>
                  Die Enhancements werden gespeichert und die Datenqualität wird im nächsten Schritt (Step 7) optimiert.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={handleCancelSave}>Abbrechen</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirmSave}>Speichern & Weiter</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
    </div>
  );
};

export default EnhancementPanel;
