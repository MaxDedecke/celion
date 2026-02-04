import { useEffect, useMemo, useState } from "react";
import { User, SquareArrowOutUpRight, CheckCircle2, XCircle, Play, Copy, Rocket, FileJson, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import TypewriterText from "./TypewriterText";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const DiscoveryReport = ({ data }: { data: any }) => {
  if (!data || !data.entities) return null;

  return (
    <div className="mt-2 space-y-4 w-full">
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <h4 className="text-sm font-semibold text-primary mb-2 flex items-center gap-2">
          <Rocket className="h-4 w-4" />
          Source Discovery Ergebnis
        </h4>
        <p className="text-sm text-foreground/90 leading-relaxed italic">
          "{data.summary}"
        </p>
        
        {data.scope?.identified && (
          <div className="mt-3 flex items-center gap-2">
            <Badge variant="outline" className="bg-background/50 border-primary/30 text-primary text-[10px]">
              Fokus: {data.scope.name || data.scope.id}
            </Badge>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="h-9 text-[11px] uppercase tracking-wider">Entität</TableHead>
              <TableHead className="h-9 text-[11px] uppercase tracking-wider text-right">Anzahl</TableHead>
              <TableHead className="h-9 text-[11px] uppercase tracking-wider text-center">Komplexität</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.entities.map((entity: any, i: number) => (
              <TableRow key={i} className="hover:bg-muted/30 border-b last:border-0">
                <TableCell className="py-2 text-sm font-medium">{entity.name}</TableCell>
                <TableCell className="py-2 text-sm text-right tabular-nums">{entity.count?.toLocaleString('de-DE')}</TableCell>
                <TableCell className="py-2 text-center">
                  {entity.complexity && (
                    <Badge 
                      variant="secondary" 
                      className={cn(
                        "text-[10px] px-1.5 py-0",
                        entity.complexity === 'low' && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
                        entity.complexity === 'medium' && "bg-amber-500/10 text-amber-600 border-amber-500/20",
                        entity.complexity === 'high' && "bg-red-500/10 text-red-600 border-red-500/20"
                      )}
                    >
                      {entity.complexity.toUpperCase()}
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

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
  onAction?: (action: string) => void;
  enableTypewriter?: boolean;
  onTypewriterComplete?: () => void;
  currentStep?: number;
}

const ChatMessage = ({ message, onOpenAgentOutput, onAction, enableTypewriter = false, onTypewriterComplete, currentStep }: ChatMessageProps) => {
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
    if (!onTypewriterComplete) return;

    // Only attempt to complete if typewriter is enabled (meaning it's currently animating or queued)
    if (!enableTypewriter) return;

    if (jsonContent) {
      // JSON messages skip animation
      onTypewriterComplete();
    } else if (message.role === "user") {
      // User messages skip animation
      onTypewriterComplete();
    }
  }, [enableTypewriter, message.role, onTypewriterComplete, jsonContent]);

  const derivedStatus = useMemo(() => {
    if (message.status) return message.status;
    const lower = message.content.toLowerCase();
    if (lower.includes("erfolgreich") || lower.includes("abgeschlossen") || lower.includes("success")) return "success";
    if (lower.includes("fehlgeschlagen") || lower.includes("failed") || lower.includes("error:")) return "error";
    return undefined;
  }, [message.status, message.content]);

  // Special Action Message Rendering
  if (jsonContent && jsonContent.type === 'action') {
    // Hide action buttons if they are from an older step
    if (currentStep !== undefined && message.step_number !== undefined && message.step_number < currentStep) {
      return null;
    }

    return (
      <div className="flex w-full justify-center py-4 animate-fade-in">
        <Button 
          onClick={() => onAction && onAction(jsonContent.action)} 
          variant="outline" 
          className="gap-2 border-primary/20 hover:bg-primary/5 text-primary"
        >
          {jsonContent.label}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    );
  }

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
    if (derivedStatus === "success") return "text-emerald-500";
    if (derivedStatus === "error") return "text-red-500";
    if (message.role === "user") return "text-primary";
    return "text-primary";
  };

  const getTextColor = () => {
    switch (derivedStatus) {
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

  const processLinks = (text: string) => {
    const linkRegex = /\[(.*?)\]\((.*?)\)/g;
    // Also match raw URLs that aren't already in markdown links
    const urlRegex = /(?<!\]\()(\bhttps?:\/\/[^\s\)]+)/g;
    
    // Simplification: Just handle raw URLs for now if not mixed, but to be safe use split logic
    const parts = [];
    let lastIndex = 0;
    
    // We can use a simpler approach: split by space and check if url? 
    // Or just use the original logic but enhanced
    
    const combinedRegex = /\[(.*?)\]\((.*?)\)|(\bhttps?:\/\/[^\s\)]+)/g;
    let match;

    while ((match = combinedRegex.exec(text)) !== null) {
      const index = match.index;
      if (index > lastIndex) {
        parts.push(text.substring(lastIndex, index));
      }

      if (match[1] && match[2]) {
        // Markdown link [text](url)
        parts.push(
          <a key={index} href={match[2]} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">{match[1]}</a>
        );
      } else if (match[3]) {
        // Raw URL
        parts.push(
          <a key={index} href={match[3]} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">{match[3]}</a>
        );
      }
      lastIndex = index + match[0].length;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }
    return parts.length > 0 ? parts : [text];
  };

  const renderFormattedContent = (text: string) => {
    if (text === null || text === undefined) return null;
    const safeText = String(text);
    // Split by **text** markers
    const parts = safeText.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        const content = part.slice(2, -2);
        // Check if content is a URL
        if (content.match(/^https?:\/\//)) {
             return <a key={i} href={content} target="_blank" rel="noopener noreferrer" className="font-bold text-primary underline hover:text-primary/80">{content}</a>;
        }
        return <span key={i} className="font-bold text-primary">{content}</span>;
      }
      return <span key={i}>{processLinks(part)}</span>;
    });
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
              {jsonContent.entities ? (
                <DiscoveryReport data={jsonContent} />
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
                  <p className="mb-1">
                    {renderFormattedContent(
                      jsonContent.system_mode === 'source' ? "**Ergebnis der Analyse des Quellsystems:**" : 
                      jsonContent.system_mode === 'target' ? "**Ergebnis der Analyse des Zielsystems:**" : 
                      "**Ergebnis der Analyse:**"
                    )}
                  </p>
                  {jsonContent.rawOutput && (
                    <p className="mt-0 opacity-90">
                      {jsonContent.rawOutput.trim().startsWith("<") 
                          ? "[Raw Content / HTML detected - see details]"
                          : renderFormattedContent(
                              jsonContent.rawOutput.length > 300 
                              ? jsonContent.rawOutput.substring(0, 300) + "..." 
                              : jsonContent.rawOutput
                          )
                      }
                    </p>
                  )}
                </div>
              )}
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
                renderFormattedContent(message.content)
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