import { useMemo, useRef, useEffect, useState } from "react";
import { Card, CardContent} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ArrowRight, Play } from "lucide-react";
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
  const bottomSpacerRef = useRef<HTMLDivElement>(null); // New Ref for auto-scroll
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [migrationData, setMigrationData] = useState<Migration>(migration);
  const [mappingRules, setMappingRules] = useState<any[]>([]);

  // Track message count and step to avoid stale closures in polling
  const prevMessageCountRef = useRef(0);
  const currentStepRef = useRef(migration.current_step || 0);

  useEffect(() => {
    currentStepRef.current = migration.current_step || 0;
    setMigrationData(migration);
  }, [migration]);

  useEffect(() => {
    let isActive = true;
    
    // Reset state ONLY when migration ID changes
    setChatMessages([]);
    setMappingRules([]);
    prevMessageCountRef.current = 0;
    initialScrollDone.current = null;

    const fetchChatMessages = async () => {
      try {
        const response = await fetch(`/api/migrations/${migration.id}/chat?t=${Date.now()}`);
        if (!isActive) return;
        
        if (response.status === 404) return;
        if (!response.ok) return;

        const data = await response.json();
        setChatMessages(data);
      } catch (error) {
        console.error("Failed to fetch chat messages:", error);
      }
    };

    const fetchMigration = async () => {
// ... (already updated above)
    };

    const fetchMappingRules = async () => {
       // Only fetch if we are close to step 6
       if (currentStepRef.current >= 5) {
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
  }, [migration.id]); // Removed migrationData.current_step dependency

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
        // ONLY scroll to bottom if user is already near bottom
        // This prevents the "once jump" when clicking action buttons if user scrolled up
        if (isNearBottom) {
          setTimeout(() => scrollToBottom('smooth'), 100);
        }
    }
    
    prevMessageCountRef.current = newMessageCount;
  }, [chatMessages.length, isNearBottom]);


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
    // Helper to find action JSON in a message
    const findActionJson = (content: string) => {
      try {
        // 1. Try markdown code block
        const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (codeBlockMatch) {
          const json = JSON.parse(codeBlockMatch[1]);
          if (json.type === 'action') return json;
        }

        // 2. Try braces
        const firstBrace = content.indexOf("{");
        const lastBrace = content.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          const json = JSON.parse(content.substring(firstBrace, lastBrace + 1));
          if (json.type === 'action') return json;
        }

        // 3. Try full
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

    // ... (Step 6/7 logic remains same)

    if (lastActionMessage) {
      try {
        // Use same extraction logic
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
      
      // We do not want to show the button if the consultant is actively thinking,
      // or if onboarding is still incomplete (systems are TBD).
      if (isConsultantThinking || isOnboardingIncomplete) {
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