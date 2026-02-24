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
  const bottomSpacerRef = useRef<HTMLDivElement>(null); // New Ref for auto-scroll
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [migrationData, setMigrationData] = useState<Migration>(migration);
  const [mappingRules, setMappingRules] = useState<any[]>([]);

  // Track message count to detect new messages for auto-scroll
  const prevMessageCountRef = useRef(0);

  useEffect(() => {
    setMigrationData(migration);
  }, [migration]);

  useEffect(() => {
    let isActive = true;
    
    // Reset state when migration changes
    setChatMessages([]);
    setMappingRules([]);
    prevMessageCountRef.current = 0;

    const fetchChatMessages = async () => {
      try {
        const response = await fetch(`/api/migrations/${migration.id}/chat?t=${Date.now()}`);
        if (!isActive) return;
        
        const data = await response.json();
        setChatMessages(data);
      } catch (error) {
        console.error("Failed to fetch chat messages:", error);
      }
    };

    const fetchMigration = async () => {
      try {
        const response = await fetch(`/api/migrations/${migration.id}?t=${Date.now()}`);
        if (!isActive) return;
        
        const data = await response.json();
        setMigrationData(data);
      } catch (error) {
        console.error("Failed to fetch migration data:", error);
      }
    };

    const fetchMappingRules = async () => {
       // Only fetch if we are close to step 6 (e.g. step 5 completed or step 6 active)
       if (migrationData.current_step >= 5) {
          try {
            const response = await fetch(`/api/migrations/${migration.id}/mapping-rules`);
            if (!isActive) return;
            const data = await response.json();
            setMappingRules(data);
          } catch (error) {
            console.error("Failed to fetch mapping rules:", error);
          }
       }
    };

    fetchChatMessages();
    fetchMigration();
    fetchMappingRules();

    const interval = setInterval(() => {
      if (isActive) {
        fetchChatMessages();
        fetchMigration();
        fetchMappingRules();
      }
    }, 3000); // Poll every 3 seconds

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [migration.id, migrationData.current_step]); // Added migrationData.current_step dependency for rules fetch trigger

  const totalSteps = 10;
  const rawStep = migrationData.current_step || 0;
  const isStepRunning = migrationData.step_status === 'running' || migrationData.step_status === 'pending';
  const hasCurrentStepFailed = migrationData.step_status === 'failed';
  const isConsultantThinking = migrationData.consultant_status === 'thinking';

  // Wenn Schritt X läuft oder fehlgeschlagen ist, sind erst X-1 Schritte komplett fertig
  const completedCount = (isStepRunning || hasCurrentStepFailed) ? Math.max(0, rawStep - 1) : rawStep;
  const overallProgress = (completedCount / totalSteps) * 100;
  const currentStepNumber = completedCount + 1 > totalSteps ? totalSteps : completedCount + 1;
  const activeStep = AGENT_WORKFLOW_STEPS[currentStepNumber - 1];
  const runningStepIndex = Math.max(0, (rawStep || 1) - 1);
  const runningStep = AGENT_WORKFLOW_STEPS[runningStepIndex];
  const currentStepTitle = activeStep?.title || (completedCount === totalSteps ? "Abgeschlossen" : "Bereit");

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      // Increased threshold to 150px to be more forgiving
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

  // Initial scroll to bottom: Instant jump
  const initialScrollDone = useRef<string | null>(null);
  
  useEffect(() => {
    if (chatMessages.length > 0 && initialScrollDone.current !== migration.id) {
      // Small timeout to allow render
      const timeoutId = setTimeout(() => {
        scrollToBottom('auto'); // Instant scroll
        initialScrollDone.current = migration.id;
        prevMessageCountRef.current = chatMessages.length; // Sync count
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [migration.id, chatMessages.length > 0]);

  // Auto-scroll on NEW messages
  useEffect(() => {
    const newMessageCount = chatMessages.length;
    
    // Check if new messages arrived
    if (newMessageCount > prevMessageCountRef.current) {
        // Always scroll to bottom for new messages as requested ("Fokus setzen")
        // Use timeout to wait for rendering (especially if animation starts)
        setTimeout(() => scrollToBottom('smooth'), 100);
    }
    
    prevMessageCountRef.current = newMessageCount;
  }, [chatMessages.length]);


  // Continuous scroll while running (if user hasn't scrolled away)
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    
    if (isStepRunning || isConsultantThinking) {
      intervalId = setInterval(() => {
        if (isNearBottom) {
          scrollToBottom('smooth');
        }
      }, 500); // Decreased frequency slightly to reduce jitter
    }
    
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isStepRunning, isConsultantThinking, isNearBottom]);

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

    // Special case for Step 6: If no mappings exist, show "Create Mappings" button
    if (currentStepNumber === 6 && mappingRules.length === 0) {
       return (
        <div className="flex flex-wrap gap-2">
          <Button 
            onClick={() => onAction && onAction('open-mapping-ui')} 
            variant="default" 
            size="sm"
            className="h-8 text-xs gap-1.5 animate-fade-in"
          >
            Mapping erstellen
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button 
            onClick={() => onAction && onAction(`retry:5`)} 
            variant="outline" 
            size="sm"
            className="h-8 text-xs gap-1.5 animate-fade-in border-primary/20 hover:bg-primary/5 text-primary"
          >
            <Play className="h-3 w-3" />
            Schritt 5 wiederholen
          </Button>
        </div>
      );
    }

    // Special case for Step 7: Quality Enhancement
    if (currentStepNumber === 7) {
       return (
        <div className="flex flex-wrap gap-2">
          <Button 
            onClick={() => onAction && onAction('open-enhancement-ui')} 
            variant="default" 
            size="sm"
            className="h-8 text-xs gap-1.5 animate-fade-in"
          >
            Enhancements konfigurieren
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button 
            onClick={() => onContinue()} 
            variant="outline" 
            size="sm"
            className="h-8 text-xs gap-1.5 animate-fade-in border-primary/20 hover:bg-primary/5 text-primary"
          >
            Überspringen
            <ArrowRight className="h-3.5 w-3.5 opacity-50" />
          </Button>
        </div>
      );
    }

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

    if (migrationData.status !== "completed") {
      const isStartButton = migrationData.status === "not_started";
      
      // Don't show the default button during onboarding (Step 0) 
      // until it officially switches to "not_started" (Start button)
      if (rawStep === 0 && !isStartButton) {
        return null;
      }

      const label = isStartButton 
        ? "Starten" 
        : hasCurrentStepFailed 
          ? `Schritt wiederholen: ${runningStep?.title}` 
          : `Weiter zu Schritt ${currentStepNumber}: ${activeStep?.title}`;
      
      return (
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
          
          {/* Permanent Retry Button for the current technical step (if already started once) */}
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
      );
    }

    return null;
  }, [isStepRunning, isConsultantThinking, lastActionMessage, migrationData.status, rawStep, onAction, onContinue, hasCurrentStepFailed, runningStep, currentStepNumber, activeStep, mappingRules.length]);

  const handleSendMessage = (message: string) => {
    onSendMessage(message);
    // Force scroll immediately
    setTimeout(() => scrollToBottom('smooth'), 50);
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
              currentStepTitle={runningStep?.title}
              currentStep={rawStep}
            />
            {/* Spacer div for auto-scrolling */}
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
            placeholder={isStepRunning ? "Agent arbeitet..." : isConsultantThinking ? "Consultant denkt nach..." : "Nächsten Schritt starten oder Befehl eingeben..."} 
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default MigrationChatCard;