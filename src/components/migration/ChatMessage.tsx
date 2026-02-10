import { useEffect, useMemo, useState } from "react";
import { User, SquareArrowOutUpRight, CheckCircle2, XCircle, Play, Copy, Rocket, FileJson, ArrowRight, Clock, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import TypewriterText from "./TypewriterText";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

const DiscoveryReport = ({ data }: { data: any }) => {
  if (!data || !data.entities) return null;

  return (
    <div className="mt-2 space-y-4 w-full">
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-primary flex items-center gap-2">
            <Rocket className="h-4 w-4" />
            Source Discovery Ergebnis
          </h4>
          {data.complexityScore && (
            <Badge variant="outline" className="border-primary/30 text-primary">
              Komplexität: {data.complexityScore}/10
            </Badge>
          )}
        </div>
        <p className="text-sm text-foreground/90 leading-relaxed italic mb-3">
          "{typeof data.summary === 'string' ? data.summary : String(data.summary || '')}"
        </p>
        
        <div className="flex flex-wrap gap-2">
          {data.scope?.identified && (
            <Badge variant="outline" className="bg-background/50 border-primary/30 text-primary text-[10px]">
              Fokus: {data.scope.name || data.scope.id}
            </Badge>
          )}
          {data.estimatedDurationMinutes && (
            <Badge variant="outline" className="bg-background/50 border-amber-500/30 text-amber-600 text-[10px] flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Est. Dauer: ~{data.estimatedDurationMinutes} Min.
            </Badge>
          )}
        </div>
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
                <TableCell className="py-2 text-sm text-right tabular-nums">
                  {entity.count?.toLocaleString('de-DE')}
                  {entity.size_mb !== undefined && entity.size_mb !== null && (
                    <span className="text-[10px] text-muted-foreground ml-1">
                      ({entity.size_mb < 1024 
                        ? `${entity.size_mb.toFixed(1)} MB` 
                        : `${(entity.size_mb / 1024).toFixed(2)} GB`})
                    </span>
                  )}
                </TableCell>
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
  const { toast } = useToast();

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

  const handleCopyJson = () => {
    if (jsonContent) {
      navigator.clipboard.writeText(JSON.stringify(jsonContent, null, 2));
      toast({
        title: "Kopiert",
        description: "JSON wurde in die Zwischenablage kopiert.",
      });
    }
  };

  useEffect(() => {
    if (!onTypewriterComplete) return;

    // Only attempt to complete if typewriter is enabled
    if (!enableTypewriter) return;

    if (jsonContent) {
      // JSON messages skip typewriter animation
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
    const actions = jsonContent.actions || (jsonContent.action ? [jsonContent] : []);
    
    return (
      <div className="flex w-full justify-center gap-3 py-4 animate-fade-in flex-wrap">
        {actions.map((action: any, idx: number) => {
          // Logic for hiding 'continue' button if we are already in a later step
          if (action.action === 'continue' && currentStep !== undefined && message.step_number !== undefined && message.step_number < currentStep) {
            return null;
          }
          
          // Retry buttons always stay visible
          
          return (
            <Button 
              key={idx}
              onClick={() => onAction && onAction(action.action === 'retry' ? `retry:${action.stepNumber}` : action.action)} 
              variant={action.variant || "outline"} 
              size="sm"
              className={cn(
                "gap-2",
                action.variant === "primary" ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border-primary/20 hover:bg-primary/5 text-primary"
              )}
            >
              {action.label}
              {action.action === 'continue' ? <ArrowRight className="h-4 w-4" /> : <Play className="h-3 w-3" />}
            </Button>
          );
        })}
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
    if (message.role === "assistant") return Sparkles;
    
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
        "flex w-full gap-3 py-2 transition-all duration-300",
        message.role === "user" ? "flex-row-reverse animate-slide-up" : "flex-row animate-fade-in"
      )}
    >
      <div className="h-8 w-8 shrink-0 flex items-center justify-center">
        {Icon && (
          <Icon className={cn("h-4 w-4", getIconColor())} />
        )}
      </div>
      
      <div className={cn(
        "flex flex-col min-w-0",
        message.role === "user" ? "items-end ml-auto" : "items-start mr-auto",
        "max-w-[70%] sm:max-w-[60%] md:max-w-[50%]"
      )}>
        <div className={cn("mb-1 flex items-center gap-2", message.role === "user" && "flex-row-reverse")}>
          {message.stepInfo && (
            <Badge variant="outline" className="text-[10px] font-medium">
              {message.stepInfo.title}
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground">{formatTimestamp(displayTime)}</span>
        </div>
        
        <div className={cn(
          "rounded-2xl px-4 py-3 text-sm leading-relaxed w-fit border shadow-sm transition-all duration-200",
          message.role === "user" 
            ? "bg-primary/5 border-primary/5 text-foreground text-left" 
            : "bg-muted/30 border-muted/30 text-foreground text-left hover:border-primary/10 hover:shadow-md",
          derivedStatus === "success" && "bg-emerald-500/5 border-emerald-500/5 shadow-emerald-500/5",
          derivedStatus === "error" && "bg-red-500/5 border-red-500/5 shadow-red-500/5",
          message.role === "system" && "bg-muted/20 border-muted/20 italic text-muted-foreground"
        )}>
          {jsonContent ? (
            <div className="flex flex-col gap-2">
              {jsonContent.entities ? (
                <DiscoveryReport data={jsonContent} />
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
                  <p className="mb-1 font-semibold">
                    {jsonContent.system_mode === 'source' ? "Analyse Quellsystem:" : 
                     jsonContent.system_mode === 'target' ? "Analyse Zielsystem:" : 
                     "Ergebnis:"}
                  </p>
                  {jsonContent.rawOutput && (
                    <div className="mt-0 opacity-90 prose prose-sm dark:prose-invert max-w-none text-foreground">
                      {typeof jsonContent.rawOutput === 'string' ? (
                        jsonContent.rawOutput.trim().startsWith("<") 
                          ? "[Raw Content / HTML detected - see details]"
                          : renderFormattedContent(
                              jsonContent.rawOutput.length > 300 
                              ? jsonContent.rawOutput.substring(0, 300) + "..." 
                              : jsonContent.rawOutput
                          )
                      ) : (
                        <p className="text-xs italic text-muted-foreground">
                          [Strukturierte Daten - Details anzeigen]
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => setShowJsonDialog(true)} 
                className="h-7 text-xs bg-background/50 hover:bg-background mt-1 w-48 self-center"
              >
                <FileJson className="w-3 h-3 mr-2" />
                Details anzeigen
              </Button>
            </div>
          ) : (
            <>
              {enableTypewriter && message.role !== "user" ? (
                <TypewriterText text={message.content} speed={8} onComplete={onTypewriterComplete} />
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

      <Dialog open={showJsonDialog} onOpenChange={setShowJsonDialog}>
        <DialogContent className="max-w-3xl">
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-10 top-3 h-6 w-6 rounded-sm opacity-70 transition-opacity hover:opacity-100"
            onClick={handleCopyJson}
            title="JSON kopieren"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
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
  );
};

export default ChatMessage;