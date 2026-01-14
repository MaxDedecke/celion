import { useMemo, useRef, useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
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
  onOpenAgentOutput: (stepId: string) => void;
}


const MigrationChatCard = ({
  migration,
  onSendMessage,
  onContinue,
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
        const response = await fetch(`/api/migrations/${migration.id}/chat`);
        const data = await response.json();
        setChatMessages(data);
      } catch (error) {
        console.error("Failed to fetch chat messages:", error);
      }
    };

    const fetchMigration = async () => {
      try {
        const response = await fetch(`/api/migrations/${migration.id}`);
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
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  useEffect(() => {
    if (scrollContainerRef.current && isNearBottom) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [chatMessages, migrationData.step_status, isNearBottom]);

  const totalSteps = 10;
  const rawStep = migrationData.current_step || 0;
  // Auch 'pending' als laufend betrachten, damit die UI sofort reagiert
  const isStepRunning = migrationData.step_status === 'running' || migrationData.step_status === 'pending';
  
  // Wenn Schritt X läuft, sind erst X-1 Schritte komplett fertig
  const completedCount = isStepRunning ? Math.max(0, rawStep - 1) : rawStep;
  const hasCurrentStepFailed = migrationData.step_status === 'failed';
  const overallProgress = (completedCount / totalSteps) * 100;
  const currentStepNumber = completedCount + 1 > totalSteps ? totalSteps : completedCount + 1;
  const activeStep = AGENT_WORKFLOW_STEPS.find(s => s.step === currentStepNumber);
  const currentStepTitle = activeStep?.title || (completedCount === totalSteps ? "Abgeschlossen" : "Bereit");

  return (
    <Card 
      style={{ height: "calc(100vh - 180px)" }} 
      className="flex flex-col overflow-hidden bg-transparent border-transparent"
    >
      <CardHeader className="shrink-0 py-3 px-4">
        {/* Compact Status Header */}
        <div className="flex flex-col gap-2">
          {/* Main Row: Stepper Dots + Step Info + Progress */}
          <div className="flex items-center gap-4">
            {/* Stepper Dots */}
            <StepperDots 
              totalSteps={totalSteps} 
              completedSteps={completedCount} 
              isCurrentStepRunning={isStepRunning}
              hasCurrentStepFailed={hasCurrentStepFailed}
            />
            
            {/* Step Info */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-sm font-medium text-foreground truncate">
                Schritt {currentStepNumber} von {totalSteps}: {currentStepTitle}
              </span>
              {isStepRunning && (
                <span className="text-xs text-muted-foreground animate-pulse">
                  Wird ausgeführt...
                </span>
              )}
              {!isStepRunning && hasCurrentStepFailed && (
                <span className="text-xs text-destructive font-medium">
                  Fehlgeschlagen – Wiederholen
                </span>
              )}
            </div>
            
            {/* Progress Percentage */}
            <span className="text-sm font-semibold text-muted-foreground tabular-nums">
              {Math.round(overallProgress)}%
            </span>
          </div>
          
          {/* Progress Bar */}
          <Progress 
            value={overallProgress} 
            className="h-1.5"
          />
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-4 pt-0">
        <div className="relative min-h-0 flex-1">
          <div ref={scrollContainerRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto">
            <ChatMessageList 
              messages={chatMessages} 
              isAgentRunning={isStepRunning} 
              onOpenAgentOutput={onOpenAgentOutput}
              showContinueButton={(migrationData.status === "not_started" || migrationData.status === "running") && overallProgress < 100 && !isStepRunning}
              onContinue={onContinue}
              continueButtonText={
                migrationData.status === "not_started" 
                  ? "Starten" 
                  : hasCurrentStepFailed 
                    ? `↻ Schritt wiederholen: ${activeStep?.title}` 
                    : `Fortsetzen: ${AGENT_WORKFLOW_STEPS.find(s => s.step === currentStepNumber)?.title}`
              }
              currentStepTitle={activeStep?.title}
            />
          </div>
          
          {!isNearBottom && (
            <Button
              onClick={scrollToBottom}
              size="icon"
              variant="secondary"
              className="absolute bottom-24 right-4 z-10 h-8 w-8 rounded-full shadow-md animate-fade-in hover:scale-105 transition-transform"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="mt-4 pt-4">
          <ChatInput 
            disabled={isStepRunning} 
            onSend={onSendMessage} 
            placeholder={isStepRunning ? "Agent arbeitet..." : "Nächsten Schritt starten oder Befehl eingeben..."} 
          />
        </div>
      </CardContent>
    </Card>
  );
};


export default MigrationChatCard;
