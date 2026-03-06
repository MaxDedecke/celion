import { useMemo, useRef, useEffect, useState } from "react";
import { Card, CardContent} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ArrowRight, Play, ArrowLeftRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import ChatMessageList from "./ChatMessageList";
import ChatInput from "./ChatInput";
import type { ChatMessage } from "./ChatMessage";
import { AGENT_WORKFLOW_STEPS } from "@/constants/agentWorkflow";
import type { MigrationProject as Migration } from "./types";

interface MigrationChatCardProps {
  migration: Migration;
  onSendMessage: (message: string) => void;
  onContinue: () => void;
  onAction?: (action: string) => void;
  onOpenAgentOutput: (stepId: string) => void;
}


const MigrationChatCard = ({
  migration,
  onSendMessage,
  onContinue,
  onAction,
  onOpenAgentOutput
}: MigrationChatCardProps) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomSpacerRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [migrationData, setMigrationData] = useState<Migration>(migration);
  const [mappingRules, setMappingRules] = useState<any[]>([]);
  const [isProcessingMessages, setIsProcessingMessages] = useState(false);

  const prevMessageCountRef = useRef(0);
  const currentStepRef = useRef(migration.current_step || 0);
  const initialScrollDone = useRef<string | null>(null);

  useEffect(() => {
    currentStepRef.current = migration.current_step || 0;
    setMigrationData(migration);
  }, [migration]);

  const fetchChatMessages = async (isActive: boolean) => {
    try {
      const response = await fetch(`/api/migrations/${migration.id}/chat?t=${Date.now()}`);
      if (!isActive) return;
      
      if (response.status === 404) return;
      if (!response.ok) return;

      const data = await response.json();
      setChatMessages(prev => {
        const optimisticMessages = prev.filter(m => m.id.startsWith('optimistic-'));
        const filteredOptimistic = optimisticMessages.filter(opt => 
          !data.some((real: ChatMessage) => real.role === opt.role && real.content === opt.content)
        );
        return [...data, ...filteredOptimistic];
      });
    } catch (error) {
      console.error("Failed to fetch chat messages:", error);
    }
  };

  const fetchMigration = async (isActive: boolean) => {
    try {
      const response = await fetch(`/api/migrations/${migration.id}?t=${Date.now()}`);
      if (!isActive) return;
      
      if (response.status === 404) return;
      if (!response.ok) return;

      const data = await response.json();
      setMigrationData(data);
    } catch (error) {
      console.error("Failed to fetch migration data:", error);
    }
  };

  const fetchMappingRules = async (isActive: boolean) => {
     if (currentStepRef.current >= 4) {
        try {
          const response = await fetch(`/api/migrations/${migration.id}/mapping-rules`);
          if (!isActive) return;
          
          if (response.status === 404) return;
          if (!response.ok) return;

          const data = await response.json();
          setMappingRules(data);
        } catch (error) {
          console.error("Failed to fetch mapping rules:", error);
        }
     }
  };

  useEffect(() => {
    let isActive = true;
    
    setChatMessages([]);
    setMappingRules([]);
    prevMessageCountRef.current = 0;
    initialScrollDone.current = null;

    fetchChatMessages(isActive);
    fetchMigration(isActive);
    fetchMappingRules(isActive);

    const interval = setInterval(() => {
      if (isActive) {
        fetchChatMessages(isActive);
        fetchMigration(isActive);
        fetchMappingRules(isActive);
      }
    }, 2000); 

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [migration.id]);

  const totalSteps = 8;
  const rawStep = migrationData.current_step || 0;
  const isStepRunning = migrationData.step_status === 'running' || migrationData.step_status === 'pending';
  const hasCurrentStepFailed = migrationData.step_status === 'failed';
  const isConsultantThinking = migrationData.consultant_status === 'thinking';

  const completedCount = (isStepRunning || hasCurrentStepFailed) ? Math.max(0, rawStep - 1) : rawStep;
  const currentStepNumber = completedCount + 1 > totalSteps ? totalSteps : completedCount + 1;
  const activeStep = AGENT_WORKFLOW_STEPS[currentStepNumber - 1];
  const runningStepIndex = Math.max(0, (rawStep || 1) - 1);
  const runningStep = AGENT_WORKFLOW_STEPS[runningStepIndex];

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      setIsNearBottom(scrollHeight - scrollTop - clientHeight < 150);
    }
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    if (bottomSpacerRef.current) {
        bottomSpacerRef.current.scrollIntoView({ behavior, block: 'end' });
    } else if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    if (chatMessages.length > 0 && initialScrollDone.current !== migration.id) {
      const timeoutId = setTimeout(() => {
        scrollToBottom('auto');
        initialScrollDone.current = migration.id;
        prevMessageCountRef.current = chatMessages.length;
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [migration.id, chatMessages.length > 0]);

  useEffect(() => {
    const newMessageCount = chatMessages.length;
    if (newMessageCount > prevMessageCountRef.current) {
        if (isNearBottom) {
          setTimeout(() => scrollToBottom('smooth'), 100);
        }
    }
    prevMessageCountRef.current = newMessageCount;
  }, [chatMessages.length, isNearBottom]);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    if (isStepRunning || isConsultantThinking || isProcessingMessages) {
      intervalId = setInterval(() => {
        if (isNearBottom) {
          scrollToBottom('smooth');
        }
      }, 500);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isStepRunning, isConsultantThinking, isProcessingMessages, isNearBottom]);

  const lastActionMessage = useMemo(() => {
    const findActionJson = (content: string) => {
      try {
        const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
          const json = JSON.parse(codeBlockMatch[1]);
          if (json.type === 'action') return json;
        }
        const firstBrace = content.indexOf("{");
        const lastBrace = content.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          const json = JSON.parse(content.substring(firstBrace, lastBrace + 1));
          if (json.type === 'action') return json;
        }
        const json = JSON.parse(content);
        if (json.type === 'action') return json;
      } catch (e) {
        return null;
      }
      return null;
    };

    const actionMessages = chatMessages.filter(m => findActionJson(m.content) !== null);
    return actionMessages[actionMessages.length - 1];
  }, [chatMessages]);

  const actionButtons = useMemo(() => {
    if (isStepRunning || isConsultantThinking) return null;

    if (lastActionMessage) {
      try {
        const content = lastActionMessage.content;
        let jsonContent: any = null;
        
        const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
          jsonContent = JSON.parse(codeBlockMatch[1]);
        } else {
          const firstBrace = content.indexOf("{");
          const lastBrace = content.lastIndexOf("}");
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            jsonContent = JSON.parse(content.substring(firstBrace, lastBrace + 1));
          } else {
            jsonContent = JSON.parse(content);
          }
        }

        const actions = jsonContent.actions || (jsonContent.action ? [jsonContent] : []);
        const messageIndex = chatMessages.findIndex(m => m.id === lastActionMessage.id);
        if (messageIndex !== -1) {
          const subsequentMessages = chatMessages.slice(messageIndex + 1);
          const isFulfilled = subsequentMessages.some(m => {
            if (m.role !== "user") return false;
            return actions.some((a: any) => {
              if (typeof a.action === 'string' && a.action.startsWith('send_chat:')) {
                const expectedText = a.action.substring(10).trim();
                return m.content.trim() === expectedText;
              }
              return false;
            });
          });
          if (isFulfilled) return null;
        }
        
        return actions.map((action: any, idx: number) => {
          if (action.action === 'continue' && rawStep !== undefined && lastActionMessage.step_number !== undefined && lastActionMessage.step_number < rawStep) {
            return null;
          }
          return (
            <Button 
              key={idx}
              onClick={() => onAction && onAction(action.action === 'retry' ? `retry:${action.stepNumber}` : action.action)} 
              variant={action.variant === "primary" ? "default" : "outline"} 
              size="sm"
              className={cn(
                "h-8 text-xs gap-1.5",
                action.variant !== "primary" && "border-primary/20 hover:bg-primary/5 text-primary"
              )}
            >
              {action.label}
              {action.action === 'continue' ? <ArrowRight className="h-3.5 w-3.5" /> : <Play className="h-3 w-3" />}
            </Button>
          );
        });
      } catch (e) {
        return null;
      }
    }

    if (migrationData.status !== "completed") {
      const isStartButton = migrationData.status === "not_started";
      const isOnboardingIncomplete = rawStep === 0 && (
        !migrationData.sourceSystem || 
        migrationData.sourceSystem === 'TBD' || 
        !migrationData.targetSystem || 
        migrationData.targetSystem === 'TBD'
      );
      
      if (isConsultantThinking || isOnboardingIncomplete) {
        return null;
      }

      const label = isStartButton 
        ? "Starten" 
        : hasCurrentStepFailed 
          ? `Schritt wiederholen: ${runningStep?.title}` 
          : `Weiter zu Schritt ${currentStepNumber}: ${activeStep?.title}`;
      
      return (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button 
              onClick={() => onContinue()} 
              variant="default" 
              size="sm"
              className="h-8 text-xs gap-1.5 animate-fade-in"
            >
              {label}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            
            {!isStartButton && rawStep > 0 && (
              <Button 
                onClick={() => onAction && onAction(`retry:${rawStep}`)} 
                variant="outline" 
                size="sm"
                className="h-8 text-xs gap-1.5 animate-fade-in border-primary/20 hover:bg-primary/5 text-primary"
              >
                <Play className="h-3 w-3" />
                Schritt {rawStep} zurücksetzen & neu starten
              </Button>
            )}
          </div>

          {/* Quick Actions for Mapping Step (Step 4) */}
          {currentStepNumber === 4 && !hasCurrentStepFailed && (
            <div className="flex flex-wrap gap-2 mt-1">
              <Button 
                onClick={() => onAction && onAction('open-mapping-ui')} 
                variant="outline" 
                size="sm"
                className="h-8 text-xs gap-1.5 animate-fade-in border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 text-emerald-700"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                Mapping Editor öffnen
              </Button>
              
              {mappingRules.length === 0 && (
                <Button 
                  onClick={() => handleSendMessage("Bitte erstelle automatisch alle notwendigen Mappings für die aktuellen Objekte und ignoriere Felder, die nicht benötigt werden.")} 
                  variant="outline" 
                  size="sm"
                  className="h-8 text-xs gap-1.5 animate-fade-in border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  KI-Mapping Vorschläge erstellen
                </Button>
              )}
            </div>
          )}
        </div>
      );
    }
    return null;
  }, [isStepRunning, isConsultantThinking, lastActionMessage, migrationData.status, rawStep, onAction, onContinue, hasCurrentStepFailed, runningStep, currentStepNumber, activeStep, mappingRules.length, chatMessages]);

  const handleSendMessage = async (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;

    const optimisticMsg: ChatMessage = {
      id: `optimistic-${Date.now()}`,
      role: 'user',
      content: trimmed,
      created_at: new Date().toISOString(),
      migration_id: migration.id
    };
    
    setChatMessages(prev => [...prev, optimisticMsg]);
    setTimeout(() => scrollToBottom('smooth'), 50);

    onSendMessage(trimmed);
    
    setTimeout(() => {
      fetchChatMessages(true);
      fetchMigration(true);
    }, 300);
  };

  return (
    <Card 
      className="flex flex-1 flex-col overflow-hidden bg-transparent border-transparent"
    >
      <CardContent className="flex min-h-0 flex-1 flex-col p-4 pt-0">
        <div className="relative min-h-0 flex-1">
          <div ref={scrollContainerRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto pr-2 scroll-smooth">
            <ChatMessageList 
              key={migration.id}
              messages={chatMessages} 
              isAgentRunning={isStepRunning} 
              isConsultantThinking={isConsultantThinking}
              onOpenAgentOutput={onOpenAgentOutput}
              onAction={onAction}
              onProcessingChange={setIsProcessingMessages}
              currentStepTitle={runningStep?.title}
              currentStep={rawStep}
            />
            <div ref={bottomSpacerRef} className="h-2" />
          </div>
          
          {!isNearBottom && (
            <Button
              onClick={() => scrollToBottom('smooth')}
              size="icon"
              variant="secondary"
              className="absolute bottom-4 right-4 z-10 h-8 w-8 rounded-full shadow-md animate-fade-in hover:scale-105 transition-transform"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {actionButtons && (
            <div className="flex flex-wrap gap-2 justify-start animate-slide-up">
              {actionButtons}
            </div>
          )}
          
          <ChatInput 
            disabled={isStepRunning || isConsultantThinking} 
            onSend={handleSendMessage} 
            placeholder={isStepRunning || isConsultantThinking ? "Denke nach ..." : "Nächsten Schritt starten oder Befehl eingeben..."} 
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default MigrationChatCard;