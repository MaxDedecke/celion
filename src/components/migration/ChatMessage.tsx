import { useEffect } from "react";
import { User, SquareArrowOutUpRight, CheckCircle2, XCircle, Play, Copy, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import TypewriterText from "./TypewriterText";

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
  enableTypewriter?: boolean;
  onTypewriterComplete?: () => void;
}

const ChatMessage = ({ message, onOpenAgentOutput, enableTypewriter = false, onTypewriterComplete }: ChatMessageProps) => {
  // Fallback: Wenn Animation aktiviert aber Typewriter nicht gerendert wird (non-agent),
  // sofort complete melden
  useEffect(() => {
    if (enableTypewriter && message.role !== "agent" && onTypewriterComplete) {
      onTypewriterComplete();
    }
  }, [enableTypewriter, message.role, onTypewriterComplete]);

  const getIcon = () => {
    // Success/Error always have icons
    if (message.status === "success") return CheckCircle2;
    if (message.status === "error") return XCircle;
    
    // Event-based icons
    const content = message.content.toLowerCase();
    if (content.includes("gestartet") || content.includes("erstellt") || content.includes("neue migration")) return Rocket;
    if (content.includes("dupliziert") || content.includes("kopiert")) return Copy;
    
    // User always has icon
    if (message.role === "user") return User;
    
    // Everything else: no icon
    return null;
  };

  const Icon = getIcon();

  const getIconColor = () => {
    if (message.status === "success") return "text-emerald-500";
    if (message.status === "error") return "text-red-500";
    if (message.role === "user") return "text-primary";
    return "text-primary";
  };

  const getTextColor = () => {
    switch (message.status) {
      case "success": return "text-emerald-700 dark:text-emerald-300";
      case "error": return "text-red-700 dark:text-red-300";
      case "pending": return "text-amber-700 dark:text-amber-300";
      default: return "text-foreground";
    }
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
        "bg-transparent border-transparent",
        message.role === "user" && "ml-auto",
        message.role === "system" && "max-w-[85%] mx-auto",
        message.role !== "system" && "max-w-[90%]",
      )}
    >
      {/* Icon or placeholder */}
      <div className="h-8 w-8 shrink-0 flex items-center justify-center">
        {Icon && (
          <Icon className={cn("h-4 w-4", getIconColor())} />
        )}
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
        <p className={cn("text-sm leading-relaxed", getTextColor())}>
          {enableTypewriter && message.role === "agent" ? (
            <TypewriterText text={message.content} speed={35} onComplete={onTypewriterComplete} />
          ) : (
            message.content
          )}
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
