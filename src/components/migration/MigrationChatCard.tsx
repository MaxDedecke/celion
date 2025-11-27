import { useMemo, useRef, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Play, Sparkles, Workflow, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Activity } from "@/components/ActivityTimeline";
import type { AgentWorkflowStepState } from "./types";
import ChatMessageList from "./ChatMessageList";
import ChatInput from "./ChatInput";
import type { ChatMessage } from "./ChatMessage";
import { AGENT_WORKFLOW_STEPS } from "@/constants/agentWorkflow";
interface MigrationChatCardProps {
  activities: Activity[];
  isStepRunning: boolean;
  stepProgress: number;
  activeStep: AgentWorkflowStepState | null;
  completedCount: number;
  totalSteps: number;
  overallProgress: number;
  status: "not_started" | "running" | "paused" | "completed";
  sourceSystem: string;
  targetSystem: string;
  sourceObjectsDisplay: string;
  targetObjectsDisplay: string;
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
  // Check if this is a user message
  const isUserMessage = activity.title.startsWith("[user]");
  const stepInfo = extractStepFromTitle(activity.title);
  const isSystemActivity = activity.title.toLowerCase().includes("migration") || activity.title.toLowerCase().includes("erstellt") || activity.title.toLowerCase().includes("dupliziert") || activity.title.toLowerCase().includes("status");
  const mapActivityTypeToStatus = (type: Activity["type"]): ChatMessage["status"] => {
    if (type === "success" || type === "error" || type === "info") {
      return type;
    }
    return "info";
  };

  // Extract stepId from title format: "... [step:stepId]"
  const stepIdMatch = activity.title.match(/\[step:([^\]]+)\]/);
  const extractedStepId = stepIdMatch ? stepIdMatch[1] : null;

  // Check if this is a result-available message
  const isResultMessage = activity.title.includes("Hier gehts zum Agenten Output");
  const actionButton = isResultMessage && extractedStepId ? {
    label: "Ergebnis anzeigen",
    stepId: extractedStepId
  } : undefined;

  // Remove stepId encoding and [user] prefix from display title
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
  return <Card style={{
    height: "calc(100vh - 180px)"
  }} className="flex flex-col overflow-hidden bg-[#0f1729]/0 border-[#1d293b]/0">
      <CardHeader className="shrink-0 pb-2">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Progress Badge */}
          <Badge variant="secondary" className="text-xs font-semibold">
            {Math.round(overallProgress)}%
          </Badge>
          
          {/* Source/Target Info */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Quelle: {sourceObjectsDisplay}</span>
            <span>|</span>
            <span>Ziel: {targetObjectsDisplay}</span>
          </div>
          
          {/* Active Step */}
          {activeStep && (
            <>
              <Sparkles className={cn("h-4 w-4 text-primary", isStepRunning && "animate-pulse")} />
              <Badge variant="outline" className="text-xs">
                {activeStep.title}
              </Badge>
            </>
          )}
          
          {/* Step Counter */}
          <Badge variant="secondary" className="text-xs">
            {completedCount}/{totalSteps}
          </Badge>
          
          {/* Step Progress Info & Bar */}
          {(isStepRunning || activeStep) && (
            <div className="flex items-center gap-3 flex-1 min-w-[200px]">
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                Schritt {completedCount + (isStepRunning ? 1 : 0)} / {totalSteps}
                {isStepRunning && " · Wird ausgeführt..."}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-muted">
                <div 
                  className={cn("h-full rounded-full bg-primary transition-all", isStepRunning ? "duration-100" : "duration-700")} 
                  style={{ width: `${stepProgress}%` }} 
                />
              </div>
              <span className="text-xs font-semibold text-muted-foreground">
                {Math.round(stepProgress)}%
              </span>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-4">
        <div className="relative min-h-0 flex-1">
          <div ref={scrollContainerRef} onScroll={handleScroll} className="absolute inset-0 overflow-y-auto">
          <ChatMessageList 
              messages={chatMessages} 
              isAgentRunning={isStepRunning} 
              onOpenAgentOutput={onOpenAgentOutput}
              showContinueButton={(status === "not_started" || status === "running") && overallProgress < 100 && !isStepRunning}
              onContinue={onContinue}
              continueButtonText={status === "not_started" ? "Starten" : "Fortsetzen"}
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
          <ChatInput disabled={isStepRunning} onSend={onSendMessage} placeholder={isStepRunning ? "Agent arbeitet..." : "Nächsten Schritt starten oder Befehl eingeben..."} />
        </div>
      </CardContent>
    </Card>;
};
export default MigrationChatCard;