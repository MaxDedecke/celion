import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Play, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Activity } from "@/components/ActivityTimeline";
import type { AgentWorkflowStepState } from "./types";
import ChatMessageList from "./ChatMessageList";
import ChatInput from "./ChatInput";
import type { ChatMessage } from "./ChatMessage";
import { AGENT_WORKFLOW_STEPS } from "@/constants/agentWorkflow";

interface MigrationChatCardProps {
  activities: Activity[];
  matchHeight: number | null;
  isWideLayout: boolean;
  isStepRunning: boolean;
  stepProgress: number;
  activeStep: AgentWorkflowStepState | null;
  completedCount: number;
  totalSteps: number;
  overallProgress: number;
  onSendMessage: (message: string) => void;
  onContinue: () => void;
}

const extractStepFromTitle = (title: string) => {
  const titleLower = title.toLowerCase();
  
  const step = AGENT_WORKFLOW_STEPS.find((s) => {
    const phaseLower = s.phase.toLowerCase();
    const titleStepLower = s.title.toLowerCase();
    return titleLower.includes(phaseLower) || titleLower.includes(titleStepLower);
  });

  if (step) {
    return {
      title: step.title,
      phase: step.phase,
    };
  }

  return null;
};

const activityToChatMessage = (activity: Activity): ChatMessage => {
  const stepInfo = extractStepFromTitle(activity.title);
  
  const isSystemActivity = 
    activity.title.toLowerCase().includes("migration") ||
    activity.title.toLowerCase().includes("erstellt") ||
    activity.title.toLowerCase().includes("dupliziert") ||
    activity.title.toLowerCase().includes("status");

  const mapActivityTypeToStatus = (type: Activity["type"]): ChatMessage["status"] => {
    if (type === "success" || type === "error" || type === "info") {
      return type;
    }
    return "info";
  };

  return {
    id: activity.id,
    role: isSystemActivity ? "system" : "agent",
    content: activity.title,
    timestamp: activity.timestamp,
    status: mapActivityTypeToStatus(activity.type),
    stepInfo: !isSystemActivity ? stepInfo || undefined : undefined,
  };
};

const MigrationChatCard = ({
  activities,
  matchHeight,
  isWideLayout,
  isStepRunning,
  stepProgress,
  activeStep,
  completedCount,
  totalSteps,
  overallProgress,
  onSendMessage,
  onContinue,
}: MigrationChatCardProps) => {
  const chatMessages = useMemo(() => {
    return activities.map(activityToChatMessage).reverse();
  }, [activities]);

  return (
    <Card
      className="flex flex-col overflow-hidden border-border bg-card"
      style={{ height: isWideLayout && matchHeight ? `${matchHeight}px` : "600px" }}
    >
      <CardHeader className="shrink-0 border-b border-border/50 pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Chat</CardTitle>
          <div className="flex items-center gap-2">
            {activeStep && (
              <>
                <Sparkles className={cn("h-4 w-4 text-primary", isStepRunning && "animate-pulse")} />
                <Badge variant="outline" className="text-xs">
                  {activeStep.title}
                </Badge>
              </>
            )}
            <Badge variant="secondary" className="text-xs">
              {completedCount}/{totalSteps}
            </Badge>
          </div>
        </div>
        
        {(isStepRunning || activeStep) && (
          <div className="mt-2">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Schritt {completedCount + (isStepRunning ? 1 : 0)} / {totalSteps}
                {isStepRunning && " · Wird ausgeführt..."}
              </span>
              <span className="font-semibold">{Math.round(stepProgress)}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full bg-primary transition-all",
                  isStepRunning ? "duration-100" : "duration-700",
                )}
                style={{ width: `${stepProgress}%` }}
              />
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        <div className="min-h-0 flex-1 overflow-hidden">
          <ChatMessageList messages={chatMessages} isAgentRunning={isStepRunning} />
        </div>

        <div className="mt-4 space-y-2 border-t border-border/50 pt-4">
          <ChatInput
            disabled={isStepRunning}
            onSend={onSendMessage}
            placeholder={
              isStepRunning
                ? "Agent arbeitet..."
                : "Nächsten Schritt starten oder Befehl eingeben..."
            }
          />
          <Button
            onClick={onContinue}
            disabled={isStepRunning}
            className="w-full"
            size="sm"
          >
            {isStepRunning ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Läuft...
              </>
            ) : (
              <>
                <Play className="mr-2 h-3.5 w-3.5" />
                Fortsetzen
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default MigrationChatCard;
