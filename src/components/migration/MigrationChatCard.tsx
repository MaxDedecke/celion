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
import { useMigrationWebSocket } from "@/hooks/useMigrationWebSocket";

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
        const filteredOptimistic = optimisticMessages.filter(opt => {
          // Normalize content for comparison (remove ID tags and trim)
          const normalize = (c: string) => c.replace(/\[ID:[^\]]+\]/g, '').trim();
          const optContent = normalize(opt.content);
          
          return !data.some((real: ChatMessage) => {
            if (real.role !== opt.role) return false;
            return normalize(real.content) === optContent;
          });
        });
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

  const { lastEvent, isConnected } = useMigrationWebSocket(migration.id);

  useEffect(() => {
    let isActive = true;
    
    setChatMessages([]);
    setMappingRules([]);
    prevMessageCountRef.current = 0;
    initialScrollDone.current = null;

    // Initial fetch
    fetchChatMessages(isActive);
    fetchMigration(isActive);
    fetchMappingRules(isActive);

    return () => {
      isActive = false;
    };
  }, [migration.id]);

  // Refetch data when a real-time event arrives from RabbitMQ via WebSocket
  // Debounced to handle bursts of events (e.g. from Introduction Agent)
  useEffect(() => {
    let isActive = true;
    if (lastEvent) {
      console.log("[Event] Real-time update received:", lastEvent.type);
      
      const timer = setTimeout(() => {
        if (isActive) {
          fetchChatMessages(isActive);
          fetchMigration(isActive);
          fetchMappingRules(isActive);
        }
      }, 100); // 100ms debounce
      
      return () => {
        isActive = false;
        clearTimeout(timer);
      };
    }
    return () => { isActive = false; };
  }, [lastEvent]);

  // Fallback Polling when WebSocket is disconnected
  useEffect(() => {
    let isActive = true;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    if (!isConnected) {
      console.log("[Chat] WebSocket not connected, starting fallback polling...");
      pollInterval = setInterval(() => {
        if (isActive) {
          fetchChatMessages(isActive);
          fetchMigration(isActive);
          fetchMappingRules(isActive);
        }
      }, 3000); // Poll every 3 seconds
    }

    return () => {
      isActive = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [isConnected, migration.id]);

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
              onClick={() => handleActionInternal(action.action === 'retry' ? `retry:${action.stepNumber}` : action.action)} 
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
                onClick={() => handleActionInternal(`retry:${rawStep}`)} 
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
                onClick={() => handleActionInternal('open-mapping-ui')} 
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
      created_at: new Date().toISOString()
    };
    
    setChatMessages(prev => [...prev, optimisticMsg]);
    setTimeout(() => scrollToBottom('smooth'), 50);

    onSendMessage(trimmed);
    
    setTimeout(() => {
      fetchChatMessages(true);
      fetchMigration(true);
    }, 300);
  };

  const handleActionInternal = (action: string) => {
    if (action.startsWith('send_chat:')) {
      const msg = action.substring('send_chat:'.length);
      // Strip out [ID:...] for the optimistic UI but keep it for the backend
      const visibleMsg = msg.replace(/\[ID:[^\]]+\]/g, '').trim();
      
      const optimisticMsg: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        role: 'user',
        content: visibleMsg,
        created_at: new Date().toISOString()
      };
      
      setChatMessages(prev => [...prev, optimisticMsg]);
      setTimeout(() => scrollToBottom('smooth'), 50);
    }
    
    if (onAction) {
      onAction(action);
    }

    // Refresh after a delay to catch the response if WebSocket fails
    setTimeout(() => {
      fetchChatMessages(true);
      fetchMigration(true);
    }, 1000);
  };

  const chatPlaceholder = useMemo(() => {
    if (isStepRunning || isConsultantThinking) return "Denke nach ...";
    
    const isStep2WaitingForName = migrationData.current_step === 2 && 
                                 (migrationData.step_status === 'completed' || migrationData.step_status === 'failed') && 
                                 !migrationData.scopeConfig?.targetNameConfirmed;
    
    if (isStep2WaitingForName) {
      return "Gib den gewünschten Namen für den Zielbereich ein...";
    }
    
    return "Nächsten Schritt starten oder Befehl eingeben...";
  }, [isStepRunning, isConsultantThinking, migrationData.current_step, migrationData.step_status, migrationData.scopeConfig]);

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
              onAction={handleActionInternal}
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
            placeholder={chatPlaceholder} 
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default MigrationChatCard;