import { useMemo, useRef, useEffect, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Activity } from "@/components/ActivityTimeline";
import type { AgentWorkflowStepState } from "./types";
import ChatMessageList from "./ChatMessageList";
import ChatInput from "./ChatInput";
import type { ChatMessage } from "./ChatMessage";
import { AGENT_WORKFLOW_STEPS } from "@/constants/agentWorkflow";
import StepperDots from "./StepperDots";
import { Progress } from "@/components/ui/progress";

interface MigrationChatCardProps {
  activities: Activity[];
  isStepRunning: boolean;
  stepProgress: number;
  activeStep: AgentWorkflowStepState | null;
  completedCount: number;
  totalSteps: number;
  overallProgress: number;
  status: "not_started" | "running" | "paused" | "completed" | "processing";
  sourceSystem: string;
  targetSystem: string;
  sourceObjectsDisplay: string;
  targetObjectsDisplay: string;
  hasCurrentStepFailed?: boolean;
  onSendMessage: (message: string) => void;
  onContinue: () => void;
  onOpenAgentOutput: (stepId: string) => void;
}

const extractStepFromTitle = (title: string) => {
  const titleLower = title.toLowerCase();
  const step = AGENT_WORKFLOW_STEPS.find(s => {
    const phaseLower = s.phase.toLowerCase();
    const titleStepLower = s.title.toLowerCase();
    return titleLower.includes(phaseLower) || titleLower.includes(titleStepLower);
  });
  if (step) {
    return {
      title: step.title,
      phase: step.phase
    };
  }
  return null;
};

const activityToChatMessage = (activity: Activity): ChatMessage => {
  const isUserMessage = activity.title.startsWith("[user]");
  const stepInfo = extractStepFromTitle(activity.title);
  const isSystemActivity = activity.title.toLowerCase().includes("migration") || activity.title.toLowerCase().includes("erstellt") || activity.title.toLowerCase().includes("dupliziert") || activity.title.toLowerCase().includes("status");
  
  const mapActivityTypeToStatus = (type: Activity["type"]): ChatMessage["status"] => {
    if (type === "success" || type === "error" || type === "info") {
      return type;
    }
    return "info";
  };

  const stepIdMatch = activity.title.match(/\[step:([^\]]+)\]/);
  const extractedStepId = stepIdMatch ? stepIdMatch[1] : null;

  const isResultMessage = activity.title.includes("Hier gehts zum Agenten Output");
  const actionButton = isResultMessage && extractedStepId ? {
    label: "Ergebnis anzeigen",
    stepId: extractedStepId
  } : undefined;

  let displayTitle = activity.title.replace(/\s*\[step:[^\]]+\]/, '');
  if (isUserMessage) {
    displayTitle = displayTitle.replace("[user] ", "");
  }
  
  return {
    id: activity.id,
    role: isUserMessage ? "user" : isSystemActivity ? "system" : "agent",
    content: displayTitle,
    timestamp: activity.timestamp,
    status: mapActivityTypeToStatus(activity.type),
    stepInfo: !isSystemActivity && !isUserMessage ? stepInfo || undefined : undefined,
    actionButton
  };
};

const MigrationChatCard = ({
  activities,
  isStepRunning,
  stepProgress,
  activeStep,
  completedCount,
  totalSteps,
  overallProgress,
  status,
  sourceSystem,
  targetSystem,
  sourceObjectsDisplay,
  targetObjectsDisplay,
  hasCurrentStepFailed,
  onSendMessage,
  onContinue,
  onOpenAgentOutput
}: MigrationChatCardProps) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  
  const chatMessages = useMemo(() => {
    return activities.map(activityToChatMessage).reverse();
  }, [activities]);

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
  }, [chatMessages, isStepRunning, isNearBottom]);

  // Determine current step number (1-indexed for display)
  const currentStepNumber = isStepRunning ? completedCount + 1 : completedCount;
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
              showContinueButton={(status === "not_started" || status === "running") && overallProgress < 100 && !isStepRunning}
              onContinue={onContinue}
              continueButtonText={
                status === "not_started" 
                  ? "Starten" 
                  : hasCurrentStepFailed 
                    ? `↻ Schritt wiederholen: ${activeStep?.title}` 
                    : "Fortsetzen"
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
