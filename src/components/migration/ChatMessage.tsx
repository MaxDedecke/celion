import { Bot, User, Settings, SquareArrowOutUpRight } from "lucide-react";
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
    return Settings;
  };

  const Icon = getIcon();

  const getStatusColor = () => {
    if (message.status === "success") return "text-emerald-600 dark:text-emerald-400";
    if (message.status === "error") return "text-red-600 dark:text-red-400";
    if (message.status === "pending") return "text-amber-600 dark:text-amber-400";
    return "text-muted-foreground";
  };

  const getBubbleStyles = () => {
    if (message.role === "user") {
      return "bg-transparent border-primary/20 ml-auto";
    }
    if (message.role === "agent") {
      return "bg-transparent border-accent/30";
    }
    return "bg-transparent border-border mx-auto";
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
        "flex w-full animate-fade-in gap-3 rounded-2xl border p-3 transition-all",
        getBubbleStyles(),
        message.role === "system" && "max-w-[85%]",
        message.role !== "system" && "max-w-[90%]",
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          message.role === "agent" && "bg-accent/20",
          message.role === "user" && "bg-primary/20",
          message.role === "system" && "bg-muted",
        )}
      >
        <Icon className={cn("h-4 w-4", getStatusColor())} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          {message.stepInfo && (
            <Badge variant="outline" className="text-[10px] font-medium">
              {message.stepInfo.title}
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground">{formatTimestamp(message.timestamp)}</span>
        </div>
        <p className="text-sm leading-relaxed">
          {message.content}
          {message.actionButton && onOpenAgentOutput && (
            <span
              onClick={() => onOpenAgentOutput(message.actionButton!.stepId)}
              className="inline-flex items-center ml-1 text-primary hover:text-primary/80 cursor-pointer transition-colors"
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
