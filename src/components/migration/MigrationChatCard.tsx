import { useMemo, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Play, Sparkles, Workflow } from "lucide-react";
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
  onOpenWorkflowPanel: () => void;
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
  onOpenWorkflowPanel,
  onOpenAgentOutput
}: MigrationChatCardProps) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  
  const chatMessages = useMemo(() => {
    return activities.map(activityToChatMessage).reverse();
  }, [activities]);

  useEffect(() => {
    if (scrollContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      
      // Nur scrollen wenn User am Ende ist
      if (isNearBottom) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
    }
  }, [chatMessages, isStepRunning]);
  return <Card style={{
    height: "calc(100vh - 180px)"
  }} className="flex flex-col overflow-hidden bg-[#0f1729]/0 border-[#1d293b]/0">
      <CardHeader className="shrink-0 border-b border-border/50 pb-3 space-y-3">
        {/* Zeile 1: Migration Info */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="text-muted-foreground">{sourceSystem}</span>
            <span className="text-muted-foreground">→</span>
            <span className="text-muted-foreground">{targetSystem}</span>
          </div>
          
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="text-xs font-semibold">
              {Math.round(overallProgress)}%
            </Badge>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Quelle: {sourceObjectsDisplay}</span>
              <span>|</span>
              <span>Ziel: {targetObjectsDisplay}</span>
            </div>
          </div>
        </div>

        {/* Zeile 2: Aktueller Schritt */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {activeStep && <>
                <Sparkles className={cn("h-4 w-4 text-primary", isStepRunning && "animate-pulse")} />
                <Badge variant="outline" className="text-xs">
                  {activeStep.title}
                </Badge>
              </>}
            <Badge variant="secondary" className="text-xs">
              {completedCount}/{totalSteps}
            </Badge>
          </div>
          <Button size="icon" variant="ghost" onClick={onOpenWorkflowPanel} className="h-7 w-7" title="Workflow bearbeiten">
            <Workflow className="h-3.5 w-3.5" />
          </Button>
        </div>
        
        {(isStepRunning || activeStep) && <div>
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Schritt {completedCount + (isStepRunning ? 1 : 0)} / {totalSteps}
                {isStepRunning && " · Wird ausgeführt..."}
              </span>
              <span className="font-semibold">{Math.round(stepProgress)}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted">
              <div className={cn("h-full rounded-full bg-primary transition-all", isStepRunning ? "duration-100" : "duration-700")} style={{
            width: `${stepProgress}%`
          }} />
            </div>
          </div>}
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-4">
        <div className="relative min-h-0 flex-1">
          <div ref={scrollContainerRef} className="absolute inset-0 overflow-y-auto">
            <ChatMessageList messages={chatMessages} isAgentRunning={isStepRunning} onOpenAgentOutput={onOpenAgentOutput} />
          </div>
        </div>

        <div className="mt-4 space-y-2 border-t border-border/50 pt-4">
          <ChatInput disabled={isStepRunning} onSend={onSendMessage} placeholder={isStepRunning ? "Agent arbeitet..." : "Nächsten Schritt starten oder Befehl eingeben..."} />
          {(status === "not_started" || status === "running") && overallProgress < 100 && <Button onClick={onContinue} disabled={isStepRunning} className="w-full" size="sm">
              {isStepRunning ? <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Läuft...
                </> : <>
                  <Play className="mr-2 h-3.5 w-3.5" />
                  {status === "not_started" ? "Starten" : "Fortsetzen"}
                </>}
            </Button>}
        </div>
      </CardContent>
    </Card>;
};
export default MigrationChatCard;