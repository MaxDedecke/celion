import { useEffect, useMemo, useState } from "react";
import { User, SquareArrowOutUpRight, CheckCircle2, XCircle, Play, Copy, Rocket, FileJson } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import TypewriterText from "./TypewriterText";

export type ChatMessageRole = "system" | "agent" | "user" | "assistant";
export type ChatMessageStatus = "success" | "error" | "pending" | "info";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  // ÄNDERUNG: 'timestamp' zu 'created_at' umbenannt (oder beides erlauben)
  created_at: string; 
  timestamp?: string; // Optional für Kompatibilität
  status?: ChatMessageStatus;
  step_number?: number;
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
  const [showJsonDialog, setShowJsonDialog] = useState(false);

  const jsonContent = useMemo(() => {
    try {
      const trimmed = message.content.trim();
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        return JSON.parse(trimmed);
      }
    } catch {
      return null;
    }
    return null;
  }, [message.content]);

  useEffect(() => {
    // If it's JSON, we skip typewriter effect essentially, so just complete it immediately
    if (jsonContent && onTypewriterComplete) {
      onTypewriterComplete();
    } else if (enableTypewriter && message.role === "user" && onTypewriterComplete) {
      onTypewriterComplete();
    }
  }, [enableTypewriter, message.role, onTypewriterComplete, jsonContent]);

  const getIcon = () => {
    if (message.status === "success") return CheckCircle2;
    if (message.status === "error") return XCircle;
    
    const content = message.content.toLowerCase();
    if (content.includes("gestartet") || content.includes("erstellt") || content.includes("neue migration")) return Rocket;
    if (content.includes("dupliziert") || content.includes("kopiert")) return Copy;
    
    if (message.role === "user") return User;
    
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

  const formatTimestamp = (ts: string | undefined) => {
    if (!ts) return "";
    const date = new Date(ts);
    return date.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const renderContentWithLinks = (text: string) => {
    const linkRegex = /\[(.*?)\]\((.*?)\)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = linkRegex.exec(text)) !== null) {
      const [fullMatch, linkText, url] = match;
      const index = match.index;

      if (index > lastIndex) {
        parts.push(text.substring(lastIndex, index));
      }

      parts.push(
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline hover:text-primary/80"
        >
          {linkText}
        </a>
      );

      lastIndex = index + fullMatch.length;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts;
  };

  // Hilfsvariable für den Zeitstempel: API sendet created_at
  const displayTime = message.created_at || message.timestamp;

  return (
    <div
      className={cn(
        "flex w-full gap-3 rounded-2xl p-2 transition-all duration-300",
        "bg-transparent border-transparent",
        message.role === "user" && "ml-auto",
        message.role === "system" && "max-w-[85%]",
        message.role !== "system" && "max-w-[90%]",
      )}
    >
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
          {/* ÄNDERUNG: Nutzung der neuen displayTime Variable */}
          <span className="text-[10px] text-muted-foreground">{formatTimestamp(displayTime)}</span>
        </div>
        <div className={cn("text-sm leading-relaxed", getTextColor())}>
          {jsonContent ? (
            <div className="flex flex-col gap-2 items-start mt-1">
              <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
                {renderContentWithLinks(jsonContent.rawOutput || "Ergebnis der Analyse:")}
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setShowJsonDialog(true)} 
                className="h-7 text-xs bg-background/50 hover:bg-background"
              >
                <FileJson className="w-3 h-3 mr-2" />
                Details anzeigen
              </Button>
              <Dialog open={showJsonDialog} onOpenChange={setShowJsonDialog}>
                <DialogContent className="max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>Agent Output Details</DialogTitle>
                  </DialogHeader>
                  <ScrollArea className="max-h-[60vh] w-full rounded-md border p-4 bg-muted/30">
                    <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                      {JSON.stringify(jsonContent, null, 2)}
                    </pre>
                  </ScrollArea>
                </DialogContent>
              </Dialog>
            </div>
          ) : (
            <>
              {enableTypewriter && message.role !== "user" ? (
                <TypewriterText text={message.content} speed={15} onComplete={onTypewriterComplete} />
              ) : (
                renderContentWithLinks(message.content)
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;