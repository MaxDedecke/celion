import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus,
  ArrowLeftRight,
  Trash2,
  Sparkles,
  Save,
  Loader2,
  MessageSquare,
  Check,
  ArrowRight
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
  enhancements?: string[];
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
  const [sourceSystemName, setSourceSystemName] = useState("Source");
  const [targetSystemName, setTargetSystemName] = useState("Target");
  
  const [mappingRules, setMappingRules] = useState<MappingRule[]>([]);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

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
        setTargetSystemName(migration.target_system);

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
                      content: "Willkommen im Quality Enhancement Editor! Hier kannst du deine Mappings durch KI-gestützte Optimierungen veredeln, z.B. durch Rechtschreibprüfung oder PII-Schwärzung.", 
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

  const mapRules = useMemo(() => {
    return mappingRules.filter(r => ['MAP', 'POLISH', 'ENHANCE'].includes(r.rule_type));
  }, [mappingRules]);

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
      setSelectedRuleId(ruleId === selectedRuleId ? null : ruleId);
  };

  const toggleEnhancement = async (ruleId: string, enhancementId: string) => {
    const rule = mappingRules.find(r => r.id === ruleId);
    if (!rule) return;

    const enhancements = rule.enhancements || [];
    const newEnhancements = enhancements.includes(enhancementId)
        ? enhancements.filter(id => id !== enhancementId)
        : [...enhancements, enhancementId];

    try {
        const response = await fetch(`/api/migrations/${migrationId}/mapping-rules/${ruleId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enhancements: newEnhancements })
        });
        if (!response.ok) throw new Error("Update failed");
        const updatedRule = await response.json();
        setMappingRules(prev => prev.map(r => r.id === ruleId ? updatedRule : r));
        toast.success(enhancements.includes(enhancementId) ? "Enhancement entfernt" : "Enhancement aktiviert");
    } catch (error) {
        console.error("Failed to update enhancements:", error);
        toast.error("Fehler beim Aktualisieren der Enhancements");
    }
  };

  const selectedRule = useMemo(() => {
    return mappingRules.find(r => r.id === selectedRuleId);
  }, [mappingRules, selectedRuleId]);

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
                    <span className="text-[10px] font-bold uppercase text-muted-foreground whitespace-nowrap">Mapping-Fokus:</span>
                    <Select value={selectedRuleId || ""} onValueChange={handleRuleSelect} disabled={mapRules.length === 0}>
                        <SelectTrigger className="h-8 w-full bg-muted/30 border-none shadow-none text-xs font-medium">
                            <SelectValue placeholder={mapRules.length > 0 ? "Mapping auswählen..." : "Keine Mappings"} />
                        </SelectTrigger>
                        <SelectContent>
                            {mapRules.map(rule => (
                                <SelectItem key={rule.id} value={rule.id}>
                                    <div className="flex items-center gap-2">
                                        {rule.rule_type !== 'MAP' && (
                                            <Badge variant="outline" className="text-[9px] h-4 px-1 bg-primary/5 text-primary border-primary/20">
                                                {rule.rule_type}
                                            </Badge>
                                        )}
                                        <div className="flex items-center gap-1 text-[11px]">
                                            <span className="font-semibold">{rule.source_object}.{rule.source_property}</span>
                                            <ArrowRight className="w-2 h-2 opacity-50" />
                                            <span className="font-semibold text-emerald-600">{rule.target_object}.{rule.target_property}</span>
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
              <ResizablePanel defaultSize={65} minSize={50} className="flex flex-col min-h-0">
                <div className="grid grid-cols-3 shrink-0">
                  <div className="bg-background p-4 flex items-center justify-center gap-2 transition-all border-b border-r">
                    <ArrowLeftRight className="w-4 h-4 text-primary" />
                    <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Aktive Mappings</span>
                  </div>

                  <div className="bg-background p-4 flex items-center justify-center gap-2 transition-all border-b border-r">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Optionen</span>
                  </div>

                  <div className="bg-background p-4 flex items-center justify-center gap-2 transition-all border-b">
                    <Check className="w-4 h-4 text-emerald-500" />
                    <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">Aktive Veredelung</span>
                  </div>
                </div>

                <div className="flex-1 grid grid-cols-3 overflow-hidden min-h-0">
                  <div className="flex flex-col min-h-0 border-r bg-muted/5">
                    <ScrollArea className="flex-1">
                      <div className="p-4 space-y-2">
                        {mapRules.map((rule) => {
                          const isSelected = selectedRuleId === rule.id;
                          const hasEnhancements = (rule.enhancements?.length || 0) > 0;
                          
                          return (
                            <div 
                              key={rule.id}
                              className={cn(
                                "group flex flex-col p-3 rounded-xl border transition-all cursor-pointer shadow-sm",
                                isSelected 
                                  ? "bg-primary/10 border-primary ring-1 ring-primary/20 shadow-primary/5" 
                                  : "bg-card border-border hover:border-primary/50",
                                hasEnhancements && !isSelected && "border-l-4 border-l-emerald-500"
                              )}
                              onClick={() => handleRuleSelect(rule.id)}
                            >
                              <div className="flex items-center justify-between mb-1">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] text-muted-foreground font-bold uppercase">{rule.source_object}</span>
                                    {rule.rule_type !== 'MAP' && (
                                        <Badge variant="outline" className="h-3.5 text-[7px] px-1 bg-muted/50 text-muted-foreground border-muted-foreground/20 uppercase tracking-tighter">
                                            {rule.rule_type}
                                        </Badge>
                                    )}
                                </div>
                                {hasEnhancements && <Badge className="h-4 text-[8px] px-1 bg-emerald-500 text-white">{rule.enhancements?.length} aktiv</Badge>}
                              </div>
                              <div className="flex items-center gap-2 text-xs font-medium">
                                <span className="text-foreground truncate">{rule.source_property}</span>
                                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                                <span className="text-emerald-600 truncate">{rule.target_property}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="flex flex-col min-h-0 border-r">
                    <ScrollArea className="flex-1">
                      {selectedRule ? (
                        <div className="p-4 space-y-3">
                          {ENHANCEMENT_TYPES.map((enhancement) => {
                            const isActive = selectedRule.enhancements?.includes(enhancement.id);
                            
                            return (
                              <div 
                                key={enhancement.id}
                                className={cn(
                                  "flex items-center gap-4 p-3 rounded-xl border transition-all cursor-pointer group",
                                  isActive 
                                    ? "bg-emerald-500/10 border-emerald-500 ring-1 ring-emerald-500/20 shadow-emerald-500/5" 
                                    : "bg-card border-dashed hover:border-primary/30"
                                )}
                                onClick={() => toggleEnhancement(selectedRule.id, enhancement.id)}
                              >
                                <div className="flex-1 flex flex-col">
                                  <div className="flex items-center justify-between">
                                      <span className={cn("text-sm font-semibold transition-colors", isActive ? "text-emerald-600" : "text-foreground")}>{enhancement.name}</span>
                                      {isActive && <Check className="w-3 h-3 text-emerald-600" />}
                                  </div>
                                  <span className="text-[10px] text-muted-foreground mt-0.5">{enhancement.description}</span>
                                </div>
                                {!isActive && <Plus className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100" />}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full p-8 text-center opacity-40">
                            <ArrowLeftRight className="w-12 h-12 mb-4 text-muted-foreground" />
                            <p className="text-sm font-medium">Wählen Sie links ein Mapping aus, um Optionen zu sehen.</p>
                        </div>
                      )}
                    </ScrollArea>
                  </div>

                  <div className="flex flex-col min-h-0 bg-muted/5">
                    <ScrollArea className="flex-1">
                        {selectedRule && selectedRule.enhancements && selectedRule.enhancements.length > 0 ? (
                            <div className="p-4 space-y-3">
                                {selectedRule.enhancements.map(id => {
                                    const enh = ENHANCEMENT_TYPES.find(e => e.id === id);
                                    if (!enh) return null;
                                    return (
                                        <div key={id} className="p-3 bg-background rounded-xl border border-emerald-500/30 flex items-center justify-between group shadow-sm">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-bold text-emerald-600">{enh.name}</span>
                                                <span className="text-[10px] text-muted-foreground italic">Wird auf '{selectedRule.target_property}' angewendet</span>
                                            </div>
                                            <Button 
                                                variant="ghost" size="icon" 
                                                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                                onClick={() => toggleEnhancement(selectedRule.id, id)}
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    );
                                })}
                                <div className="mt-8 p-4 rounded-xl border border-dashed border-primary/20 bg-primary/5">
                                    <h4 className="text-[10px] font-bold uppercase text-primary mb-2 flex items-center gap-1.5">
                                        <Sparkles className="w-3 h-3" />
                                        KI-Vorschau
                                    </h4>
                                    <div className="text-[11px] text-muted-foreground leading-relaxed">
                                        Die gewählten Optimierungen werden in Schritt 8 (Datentransfer) automatisch auf alle Datensätze angewendet.
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full p-8 text-center opacity-40">
                                <Sparkles className="w-12 h-12 mb-4 text-muted-foreground" />
                                <p className="text-sm font-medium">Keine aktiven Veredelungen für dieses Mapping.</p>
                            </div>
                        )}
                    </ScrollArea>
                  </div>
                </div>
              </ResizablePanel>

              <ResizableHandle withHandle />

              <ResizablePanel defaultSize={35} maxSize={50} minSize={25} className="flex flex-col min-h-0 bg-muted/10">
                 <div className="px-4 py-3 bg-background/50 flex items-center gap-2 shrink-0 border-b">
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
                      onClick={() => handleSendMessage("Analysiere meine aktuellen Mappings und schlage passende Qualitäts-Enhancements vor, besonders für Textfelder.")}
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
