import { useMemo, useRef, useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ArrowRight, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentWorkflowStepState } from "./types";
import ChatMessageList from "./ChatMessageList";
import ChatInput from "./ChatInput";
import type { ChatMessage } from "./ChatMessage";
import { AGENT_WORKFLOW_STEPS } from "@/constants/agentWorkflow";
import StepperDots from "./StepperDots";
import { Progress } from "@/components/ui/progress";
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
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [migrationData, setMigrationData] = useState<Migration>(migration);

  useEffect(() => {
    setMigrationData(migration);
  }, [migration]);

  useEffect(() => {
    const fetchChatMessages = async () => {
      try {
        const response = await fetch(`/api/migrations/${migration.id}/chat?t=${Date.now()}`);
        const data = await response.json();
        setChatMessages(data);
      } catch (error) {
        console.error("Failed to fetch chat messages:", error);
      }
    };

    const fetchMigration = async () => {
      try {
        const response = await fetch(`/api/migrations/${migration.id}?t=${Date.now()}`);
        const data = await response.json();
        setMigrationData(data);
      } catch (error) {
        console.error("Failed to fetch migration data:", error);
      }
    };

    fetchChatMessages();
    fetchMigration();

    const interval = setInterval(() => {
      fetchChatMessages();
      fetchMigration();
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(interval);
  }, [migration.id]);

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      setIsNearBottom(scrollHeight - scrollTop - clientHeight < 100);
    }
  };

  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  };

  const totalSteps = 10;
  const rawStep = migrationData.current_step || 0;
  // Auch 'pending' als laufend betrachten, damit die UI sofort reagiert
  const isStepRunning = migrationData.step_status === 'running' || migrationData.step_status === 'pending';
  
  const hasCurrentStepFailed = migrationData.step_status === 'failed';
  const isConsultantThinking = migrationData.consultant_status === 'thinking';

  // Initial scroll to bottom when chat messages are loaded for the first time or migration changes
  const initialScrollDone = useRef<string | null>(null);
  useEffect(() => {
    if (chatMessages.length > 0 && initialScrollDone.current !== migration.id) {
      // Use a small delay to ensure DOM is fully rendered
      const timeoutId = setTimeout(() => {
        scrollToBottom();
        initialScrollDone.current = migration.id;
      }, 150);
      return () => clearTimeout(timeoutId);
    }
  }, [migration.id, chatMessages.length > 0]);

  // Regular scroll to bottom when new messages arrive and user is near bottom
  useEffect(() => {
    if (scrollContainerRef.current && isNearBottom) {
      scrollToBottom();
    }
  }, [chatMessages, migrationData.step_status, isStepRunning, isNearBottom]);

  // Continuous scroll while something is animating (typewriter)
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    
    // Wenn der Agent läuft oder der Consultant denkt, scrollen wir mit
    if (isStepRunning || isConsultantThinking) {
      intervalId = setInterval(() => {
        if (isNearBottom) {
          scrollToBottom();
        }
      }, 100);
    }
    
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isStepRunning, isConsultantThinking, isNearBottom]);

  // Wenn Schritt X läuft oder fehlgeschlagen ist, sind erst X-1 Schritte komplett fertig
  const completedCount = (isStepRunning || hasCurrentStepFailed) ? Math.max(0, rawStep - 1) : rawStep;
  
  const overallProgress = (completedCount / totalSteps) * 100;
  const currentStepNumber = completedCount + 1 > totalSteps ? totalSteps : completedCount + 1;
  // Fix: Access by index (0-based) using currentStepNumber (1-based)
  const activeStep = AGENT_WORKFLOW_STEPS[currentStepNumber - 1];
  
  // Der Titel für den Indicator/Laufenden Schritt sollte sich auf den *tatsächlichen* Schritt beziehen (rawStep)
  // Wenn rawStep 1 ist (System Detection), wollen wir "Analysiere System Detection", auch wenn completedCount schon 1 ist.
  const runningStepIndex = Math.max(0, (rawStep || 1) - 1);
  const runningStep = AGENT_WORKFLOW_STEPS[runningStepIndex];
  const currentStepTitle = activeStep?.title || (completedCount === totalSteps ? "Abgeschlossen" : "Bereit");

  // Extract latest action message
  const lastActionMessage = useMemo(() => {
    const actionMessages = chatMessages.filter(m => {
      try {
        const parsed = JSON.parse(m.content);
        return parsed.type === 'action';
      } catch {
        return false;
      }
    });
    return actionMessages[actionMessages.length - 1];
  }, [chatMessages]);

  const actionButtons = useMemo(() => {
    if (isStepRunning || isConsultantThinking) return null;

    if (lastActionMessage) {
      try {
        const jsonContent = JSON.parse(lastActionMessage.content);
        const actions = jsonContent.actions || (jsonContent.action ? [jsonContent] : []);
        
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

    // Fallback Continue Button
    if (migrationData.status !== "completed") {
      const label = migrationData.status === "not_started" 
        ? "Starten" 
        : hasCurrentStepFailed 
          ? `Schritt wiederholen: ${runningStep?.title}` 
          : `Weiter zu Schritt ${currentStepNumber}: ${activeStep?.title}`;
      
      return (
        <Button 
          onClick={() => onContinue()} 
          variant="default" 
          size="sm"
          className="h-8 text-xs gap-1.5 animate-fade-in"
        >
          {label}
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      );
    }

    return null;
  }, [isStepRunning, isConsultantThinking, lastActionMessage, migrationData.status, rawStep, onAction, onContinue, hasCurrentStepFailed, runningStep, currentStepNumber, activeStep]);

  const handleSendMessage = (message: string) => {
    onSendMessage(message);
    // Force scroll to bottom when user sends a message
    setTimeout(scrollToBottom, 100);
  };

  return (
    <Card 
      style={{ height: "calc(100vh - 180px)" }} 
      className="flex flex-col overflow-hidden bg-transparent border-transparent"
    >
      <CardHeader className="shrink-0 py-3 px-4">
        {/* Compact Status Header */}
        <div className="flex flex-col gap-3">
          {/* Main Row: Stepper Dots + Step Info */}
          <div className="flex items-center gap-4 min-w-0">
            {/* Stepper Dots */}
            <StepperDots 
              totalSteps={totalSteps} 
              completedSteps={completedCount} 
              isCurrentStepRunning={isStepRunning}
              hasCurrentStepFailed={hasCurrentStepFailed}
            />
            
            {/* Step Info */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold text-foreground truncate">
                Schritt {currentStepNumber}: {currentStepTitle}
              </span>
              {isStepRunning && (
                <span className="text-xs text-primary animate-pulse font-medium">
                  Wird ausgeführt...
                </span>
              )}
            </div>
          </div>
          
          {/* Progress Bar Row */}
          <div className="flex flex-col gap-1.5 mt-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Fortschritt</span>
              <span className="text-sm font-bold text-primary tabular-nums">
                {Math.round(overallProgress)}%
              </span>
            </div>
            <Progress 
              value={overallProgress} 
              className="h-1.5 w-full"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-4 pt-0">
        <div className="relative min-h-0 flex-1">
          <div ref={scrollContainerRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto pr-2">
            <ChatMessageList 
              messages={chatMessages} 
              isAgentRunning={isStepRunning} 
              isConsultantThinking={isConsultantThinking}
              onOpenAgentOutput={onOpenAgentOutput}
              onAction={onAction}
              currentStepTitle={runningStep?.title}
              currentStep={rawStep}
            />
          </div>
          
          {!isNearBottom && (
            <Button
              onClick={scrollToBottom}
              size="icon"
              variant="secondary"
              className="absolute bottom-4 right-4 z-10 h-8 w-8 rounded-full shadow-md animate-fade-in hover:scale-105 transition-transform"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Action Buttons Layer */}
        <div className="mt-4 flex flex-col gap-3">
          {actionButtons && (
            <div className="flex flex-wrap gap-2 justify-start animate-slide-up">
              {actionButtons}
            </div>
          )}
          
          <ChatInput 
            disabled={isStepRunning || isConsultantThinking} 
            onSend={handleSendMessage} 
            placeholder={isStepRunning ? "Agent arbeitet..." : isConsultantThinking ? "Consultant denkt nach..." : "Nächsten Schritt starten oder Befehl eingeben..."} 
          />
        </div>
      </CardContent>
    </Card>
  );
};


export default MigrationChatCard;
