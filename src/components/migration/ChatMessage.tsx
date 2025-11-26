import { Bot, User, Settings, SquareArrowOutUpRight, CheckCircle2, XCircle, Clock, Info, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AGENT_WORKFLOW_STEPS } from "@/constants/agentWorkflow";

export type ChatMessageRole = "system" | "agent" | "user";
export type ChatMessageStatus = "success" | "error" | "pending" | "info";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  timestamp: string;
  status?: ChatMessageStatus;
  stepInfo?: {
    title: string;
    phase: string;
  };
  actionButton?: {
    label: string;
    stepId: string;
  };
}

interface ChatMessageProps {
  message: ChatMessage;
  onOpenAgentOutput?: (stepId: string) => void;
}

const ChatMessage = ({ message, onOpenAgentOutput }: ChatMessageProps) => {
  const getIcon = () => {
    if (message.role === "agent") return Bot;
    if (message.role === "user") return User;
    return null; // System-Nachrichten haben kein Icon
  };

  const Icon = getIcon();

  const getIconBackgroundColor = () => {
    if (message.role === "agent") return "bg-accent/20";
    if (message.role === "user") return "bg-primary/20";
    return ""; // System-Nachrichten haben keinen Hintergrund
  };

  const getTextColor = () => {
    switch (message.status) {
      case "success": return "text-emerald-700 dark:text-emerald-300";
      case "error": return "text-red-700 dark:text-red-300";
      case "pending": return "text-amber-700 dark:text-amber-300";
      default: return "text-foreground";
    }
  };


  const getBubbleStyles = () => {
    if (message.role === "user") {
      return "bg-transparent border-transparent ml-auto";
    }
    if (message.role === "agent") {
      return "bg-transparent border-transparent";
    }
    return "bg-transparent border-transparent mx-auto";
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div
      className={cn(
        "flex w-full gap-3 rounded-2xl p-2 transition-all duration-300",
        getBubbleStyles(),
        message.role === "system" && "max-w-[85%]",
        message.role !== "system" && "max-w-[90%]",
      )}
    >
      {Icon ? (
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            getIconBackgroundColor()
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      ) : (
        <div className="h-8 w-8 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          {message.stepInfo && (
            <Badge variant="outline" className="text-[10px] font-medium">
              {message.stepInfo.title}
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground">{formatTimestamp(message.timestamp)}</span>
        </div>
        <p className={cn("text-sm leading-relaxed", getTextColor())}>
          {message.content}
          {message.actionButton && onOpenAgentOutput && (
            <span
              onClick={() => onOpenAgentOutput(message.actionButton!.stepId)}
              className="inline-flex items-center ml-1 text-primary hover:text-primary/80 hover:scale-110 cursor-pointer transition-all duration-200"
              title="Agenten Output öffnen"
            >
              <SquareArrowOutUpRight className="h-4 w-4" />
            </span>
          )}
        </p>
      </div>
    </div>
  );
};

export default ChatMessage;
