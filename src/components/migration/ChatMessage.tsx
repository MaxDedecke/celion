import { useEffect, useMemo, useState, Fragment } from "react";
import { User, SquareArrowOutUpRight, CheckCircle2, XCircle, Play, Copy, Rocket, FileJson, ArrowRight, Clock, Brain } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import TypewriterText from "./TypewriterText";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const LiveTransferStatus = ({ data }: { data: any }) => {
  const percentage = data.total > 0 ? Math.round((data.processed / data.total) * 100) : 0;
  
  return (
    <div className="mt-2 space-y-3 w-full animate-in fade-in duration-500 min-w-[300px] sm:min-w-[400px] md:min-w-[500px]">
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
            </div>
            <h4 className="text-sm font-semibold text-primary">Datentransfer läuft...</h4>
          </div>
          <Badge variant="outline" className="bg-background/50 border-primary/30 text-primary tabular-nums">
            {percentage}%
          </Badge>
        </div>

        <div className="space-y-2">
          <Progress value={percentage} className="h-2 bg-primary/10" />
          <div className="flex justify-between text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
            <span>{data.processed} von {data.total} Objekten</span>
            <span>{data.currentEntity || "Initialisierung"}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2 flex flex-col items-center">
          <span className="text-[10px] text-emerald-600 font-bold uppercase">Erfolgreich</span>
          <span className="text-lg font-bold text-emerald-700 tabular-nums">{data.successCount || 0}</span>
        </div>
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-2 flex flex-col items-center">
          <span className="text-[10px] text-red-600 font-bold uppercase">Fehler</span>
          <span className="text-lg font-bold text-red-700 tabular-nums">{data.errorCount || 0}</span>
        </div>
      </div>
      
      {data.status === 'completed' && (
        <div className="flex items-center justify-center gap-2 py-1 text-emerald-600 animate-bounce">
          <CheckCircle2 className="h-4 w-4" />
          <span className="text-xs font-semibold">Transfer vollständig abgeschlossen!</span>
        </div>
      )}
    </div>
  );
};

const DiscoveryReport = ({ data }: { data: any }) => {
  if (!data || !data.entities) return null;

  return (
    <div className="mt-2 space-y-4 w-full min-w-[300px] sm:min-w-[400px] md:min-w-[500px]">
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

// Utility functions for rendering content using hoisted function declarations
function processLinks(text: string) {
  const combinedRegex = /\[(.*?)\]\((.*?)\)|(\bhttps?:\/\/[^\s\)]+)/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = combinedRegex.exec(text)) !== null) {
    const index = match.index;
    if (index > lastIndex) {
      parts.push(text.substring(lastIndex, index));
    }

    if (match[1] && match[2]) {
      parts.push(
        <a key={`link-${index}`} href={match[2]} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">{match[1]}</a>
      );
    } else if (match[3]) {
      parts.push(
        <a key={`url-${index}`} href={match[3]} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">{match[3]}</a>
      );
    }
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  return parts.length > 0 ? parts : [text];
}

function renderTextSegment(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          const content = part.slice(2, -2);
          if (content.match(/^https?:\/\//)) {
              return <a key={`bold-link-${i}`} href={content} target="_blank" rel="noopener noreferrer" className="font-bold text-primary underline hover:text-primary/80">{content}</a>;
          }
          return <span key={`bold-${i}`} className="font-bold text-primary">{content}</span>;
        }
        return <Fragment key={`segment-${i}`}>{processLinks(part)}</Fragment>;
      })}
    </span>
  );
}

function renderMarkdownTable(content: string) {
  const lines = content.trim().split('\n');
  if (lines.length < 3) return null;
  if (!lines[1].includes('---') || !lines[1].includes('|')) return null;

  const headers = lines[0].split('|').filter((c, i, arr) => {
      if (i === 0 && c.trim() === '') return false;
      if (i === arr.length - 1 && c.trim() === '') return false;
      return true;
  }).map(c => c.trim());

  const rows = lines.slice(2).map(line => 
    line.split('|').filter((c, i, arr) => {
        if (i === 0 && c.trim() === '') return false;
        if (i === arr.length - 1 && c.trim() === '') return false;
        return true;
    }).map(c => c.trim())
  );

  return (
    <div key="table-container" className="my-2 rounded-md border overflow-hidden bg-card/50">
        <Table>
            <TableHeader className="bg-muted/50">
                <TableRow>
                    {headers.map((h, i) => (
                        <TableHead key={`head-${i}`} className="h-8 text-xs font-bold px-2">{h}</TableHead>
                    ))}
                </TableRow>
            </TableHeader>
            <TableBody>
                {rows.map((row, i) => (
                    <TableRow key={`row-${i}`} className="hover:bg-muted/30 border-b last:border-0">
                        {row.map((cell, j) => (
                            <TableCell key={`cell-${i}-${j}`} className="py-2 text-xs px-2">{renderFormattedContent(cell)}</TableCell>
                        ))}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    </div>
  );
}

function renderFormattedContent(text: string | null | undefined): React.ReactNode {
  if (text === null || text === undefined) return null;
  const safeText = String(text);
  const lines = safeText.split('\n');
  const parts: React.ReactNode[] = [];
  let currentTextLines: string[] = [];
  let currentTableLines: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isTableLine = line.trim().startsWith('|') || (line.trim().includes('|') && line.trim().includes('---'));

      if (inTable) {
          if (isTableLine) {
              currentTableLines.push(line);
          } else {
              parts.push(<Fragment key={`text-pre-${i}`}>{renderTextSegment(currentTextLines.join('\n'))}</Fragment>);
              currentTextLines = [];
              parts.push(<Fragment key={`table-${i}`}>{renderMarkdownTable(currentTableLines.join('\n'))}</Fragment>);
              currentTableLines = [];
              inTable = false;
              if (line.trim() !== '') currentTextLines.push(line);
          }
      } else {
          const nextLine = lines[i+1];
          if (line.trim().includes('|') && nextLine && nextLine.trim().includes('---') && nextLine.trim().includes('|')) {
               if (currentTextLines.length > 0) {
                   parts.push(<Fragment key={`text-pre-${i}`}>{renderTextSegment(currentTextLines.join('\n'))}</Fragment>);
                   currentTextLines = [];
               }
               inTable = true;
               currentTableLines.push(line);
          } else {
              currentTextLines.push(line);
          }
      }
  }

  if (inTable && currentTableLines.length > 0) {
      parts.push(<Fragment key={`table-end`}>{renderMarkdownTable(currentTableLines.join('\n'))}</Fragment>);
  } else if (currentTextLines.length > 0) {
      parts.push(<Fragment key={`text-end`}>{renderTextSegment(currentTextLines.join('\n'))}</Fragment>);
  }

  return <div className="flex flex-col gap-1">{parts}</div>;
}

export type ChatMessageRole = "system" | "agent" | "user" | "assistant";
export type ChatMessageStatus = "success" | "error" | "pending" | "info";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  created_at: string; 
  timestamp?: string;
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
  const [selectedDropdownValue, setSelectedDropdownValue] = useState<string>("");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const { toast } = useToast();

  const { jsonContent, textContent } = useMemo(() => {
    const content = message.content.trim();
    
    // 1. Try to extract JSON from markdown code block
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      try {
        const json = JSON.parse(codeBlockMatch[1]);
        const text = content.replace(codeBlockMatch[0], "").trim();
        return { jsonContent: json, textContent: text || null };
      } catch (e) {
        // Fall through
      }
    }

    // 2. Try to find the first { and last }
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        const potentialJson = content.substring(firstBrace, lastBrace + 1);
        const json = JSON.parse(potentialJson);
        const text = (content.substring(0, firstBrace) + content.substring(lastBrace + 1)).trim();
        return { jsonContent: json, textContent: text || null };
      } catch (e) {
        // Fall through
      }
    }

    // 3. Fallback: try full parse
    try {
      if (content.startsWith("{") && content.endsWith("}")) {
        const json = JSON.parse(content);
        return { jsonContent: json, textContent: null };
      }
    } catch (e) {
      // Not JSON
    }

    return { jsonContent: null, textContent: content };
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
    if (!onTypewriterComplete || !enableTypewriter) return;

    // We only reach here if enableTypewriter is true, 
    // which means this message is the current one in the queue.

    // 1. User messages never animate, complete immediately
    if (message.role === "user") {
      onTypewriterComplete();
      return;
    }

    // 2. If we have ONLY JSON content (no text), complete immediately 
    // (Special JSON components don't have typewriter support yet)
    if (jsonContent && !textContent) {
      onTypewriterComplete();
      return;
    }

    // 3. If we have no content at all, complete immediately
    if (!jsonContent && !textContent) {
      onTypewriterComplete();
      return;
    }

    // Note: If textContent is present and it's an assistant/agent message,
    // TypewriterText will handle calling onTypewriterComplete when the text is finished.
  }, [enableTypewriter, message.role, onTypewriterComplete, jsonContent, textContent]);

  const derivedStatus = useMemo(() => {
    if (message.status) return message.status;
    
    if (jsonContent) {
      if (jsonContent.status === "success" || jsonContent.success === true || jsonContent.systemMatchesUrl === true) return "success";
      if (jsonContent.status === "error" || jsonContent.error || jsonContent.systemMatchesUrl === false) return "error";
    }

    const lower = message.content.toLowerCase();
    if (lower.includes("erfolgreich") || lower.includes("abgeschlossen") || lower.includes("success")) return "success";
    if (lower.includes("fehlgeschlagen") || lower.includes("failed") || lower.includes("error:")) return "error";
    return undefined;
  }, [message.status, message.content, jsonContent]);

  const getIcon = () => {
    if (message.status === "success") return CheckCircle2;
    if (message.status === "error") return XCircle;
    
    const content = message.content.toLowerCase();
    if (content.includes("gestartet") || content.includes("erstellt") || content.includes("neue migration")) return Rocket;
    if (content.includes("dupliziert") || content.includes("kopiert")) return Copy;
    
    if (message.role === "user") return User;
    if (message.role === "assistant") return Brain;
    
    return null;
  };

  const Icon = getIcon();

  const getIconColor = () => {
    if (derivedStatus === "success") return "text-emerald-500";
    if (derivedStatus === "error") return "text-red-500";
    if (message.role === "user") return "text-primary";
    return "text-primary";
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
        jsonContent?.type === "live-transfer-status" || jsonContent?.entities 
          ? "w-full max-w-none md:max-w-[98%]" 
          : "max-w-[70%] sm:max-w-[60%] md:max-w-[50%]"
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
          "rounded-2xl px-4 py-3 text-sm leading-relaxed border shadow-sm transition-all duration-200",
          jsonContent?.type === "live-transfer-status" || jsonContent?.entities ? "w-full" : "w-fit",
          message.role === "user" 
            ? "bg-primary/5 border-primary/5 text-foreground text-left" 
            : "bg-muted/30 border-muted/30 text-foreground text-left hover:border-primary/10 hover:shadow-md",
          derivedStatus === "success" && "bg-emerald-500/5 border-emerald-500/5 shadow-emerald-500/5",
          derivedStatus === "error" && "bg-red-500/5 border-red-500/5 shadow-red-500/5",
          message.role === "system" && "bg-muted/20 border-muted/20 italic text-muted-foreground"
        )}>
          <div className="flex flex-col gap-3">
            {textContent && (
              <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
                {enableTypewriter && message.role !== "user" ? (
                  <TypewriterText text={textContent} speed={8} onComplete={onTypewriterComplete} />
                ) : (
                  renderFormattedContent(textContent.replace(/\[ID:[^\]]+\]/g, ''))
                )}
              </div>
            )}

            {jsonContent && (
              <div className="flex flex-col gap-2">
                {jsonContent.type === "live-transfer-status" ? (
                  <LiveTransferStatus data={jsonContent} />
                ) : jsonContent.entities ? (
                  <DiscoveryReport data={jsonContent} />
                ) : jsonContent.type === "action" ? (
                  <div className="flex w-full justify-center gap-3 py-2 animate-fade-in flex-wrap">
                    {(jsonContent.actions || (jsonContent.action ? [jsonContent] : [])).map((action: any, idx: number) => {
                      if (action.action === "continue" && currentStep !== undefined && message.step_number !== undefined && message.step_number < currentStep) return null;
                      return (
                        <Button 
                          key={idx}
                          onClick={() => onAction && onAction(action.action === "retry" ? `retry:${action.stepNumber}` : action.action)} 
                          variant={action.variant || "outline"} 
                          size="sm"
                          className={cn(
                            "gap-2",
                            action.variant === "primary" ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border-primary/20 hover:bg-primary/5 text-primary"
                          )}
                        >
                          {action.label}
                          {action.action === "continue" ? <ArrowRight className="h-4 w-4" /> : <Play className="h-3 w-3" />}
                        </Button>
                      );
                    })}
                  </div>
                ) : jsonContent.type === "datasource_dropdown" ? (
                  <div className="flex w-full justify-start py-2 animate-fade-in">
                    <div className="flex flex-col gap-3 p-4 rounded-xl border border-primary/20 bg-primary/5 w-full">
                      <label className="text-sm font-medium text-foreground">{jsonContent.label}</label>
                      <div className="flex items-center gap-2">
                        <Select 
                          value={selectedDropdownValue}
                          disabled={isSubmitted}
                          onValueChange={(val) => {
                            setSelectedDropdownValue(val);
                          }}>
                          <SelectTrigger className="w-full sm:w-[350px] bg-background">
                            <SelectValue placeholder="Bitte wählen..." />
                          </SelectTrigger>
                          <SelectContent>
                            {jsonContent.options?.map((o: any) => (
                              <SelectItem key={o.id} value={o.id} className={o.id === "new" ? "font-semibold text-primary" : ""}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {isSubmitted && <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />}
                      </div>
                      {selectedDropdownValue && !isSubmitted && (
                        <Button 
                          size="sm" 
                          className="w-full sm:w-[350px] bg-primary text-primary-foreground hover:bg-primary/90 mt-1"
                          onClick={() => {
                            setIsSubmitted(true);
                            const val = selectedDropdownValue;
                            const selectedOption = jsonContent.options?.find((o: any) => o.id === val);
                            const label = selectedOption ? selectedOption.label.split(' - ')[0] : val; // Clean up label to exclude URL
                            const mode = jsonContent.mode === "source" ? "Quelle" : "Ziel";
                            if (onAction) {
                              if (val === "new") onAction(`send_chat:Ich möchte eine neue Datenquelle für ${mode} anlegen.`);
                              // We include a hidden token block so the backend gets the ID, but the visible text is cleaner
                              else onAction(`send_chat:Ich wähle für ${mode} die Datenquelle '${label}'.[ID:${val}]`);
                            }
                          }}
                        >
                          Auswahl bestätigen
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
                    <p className="mb-1 font-semibold">
                      {jsonContent.system_mode === "source" ? "Analyse Quellsystem:" : 
                       jsonContent.system_mode === "target" ? "Analyse Zielsystem:" : 
                       "Ergebnis:"}
                    </p>
                    {jsonContent.rawOutput && (
                      <div className="mt-0 opacity-90 prose prose-sm dark:prose-invert max-w-none text-foreground">
                        {typeof jsonContent.rawOutput === "string" ? (
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
                {!["live-transfer-status", "action", "datasource_dropdown"].includes(jsonContent.type) && !jsonContent.entities && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setShowJsonDialog(true)} 
                    className="h-7 text-xs bg-background/80 hover:bg-accent mt-1 w-48 self-center"
                  >
                    <FileJson className="w-3 h-3 mr-2" />
                    Details anzeigen
                  </Button>
                )}
              </div>
            )}

            {!jsonContent && !textContent && (
               <span className="text-xs italic text-muted-foreground">[Leere Nachricht]</span>
            )}
          </div>

          {message.actionButton && onOpenAgentOutput && (
            <span
              onClick={() => onOpenAgentOutput(message.actionButton!.stepId)}
              className="inline-flex items-center ml-1 text-primary hover:text-primary/80 hover:scale-110 cursor-pointer transition-all duration-200"
              title="Agenten Output öffnen"
            >
              <SquareArrowOutUpRight className="h-4 w-4" />
            </span>
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