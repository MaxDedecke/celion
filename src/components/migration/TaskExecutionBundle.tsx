import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Rocket, Loader2 } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import ChatMessage, { ChatMessage as ChatMessageType } from "./ChatMessage";
import { cn } from "@/lib/utils";

interface TaskExecutionBundleProps {
  id: string;
  title: string;
  messages: ChatMessageType[];
  status: 'success' | 'error' | 'in_progress';
  summary?: string;
  allMessages: ChatMessageType[];
  onOpenAgentOutput?: (stepId: string) => void;
  onAction?: (action: string) => void;
  currentStep?: number;
  animatingId?: string | null;
  completedAnimations?: Set<string>;
  onAnimationComplete?: (id: string) => void;
}

const TaskExecutionBundle = ({
  id,
  title,
  messages,
  status,
  summary,
  allMessages,
  onOpenAgentOutput,
  onAction,
  currentStep,
  animatingId,
  completedAnimations,
  onAnimationComplete
}: TaskExecutionBundleProps) => {
  const getStatusIcon = () => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'in_progress':
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      default:
        return <Rocket className="h-4 w-4 text-primary" />;
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'success':
        return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]">Abgeschlossen</Badge>;
      case 'error':
        return <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20 text-[10px]">Fehlgeschlagen</Badge>;
      case 'in_progress':
        return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[10px]">In Arbeit</Badge>;
      default:
        return null;
    }
  };

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="bundle" className="border border-primary/10 bg-primary/5 rounded-xl px-4 overflow-hidden mb-2 animate-fade-in shadow-sm">
        <AccordionTrigger className="py-3 hover:no-underline text-sm font-medium flex items-center justify-between group">
          <div className="flex items-center gap-3 text-left">
            <div className={cn(
              "h-8 w-8 rounded-full flex items-center justify-center shadow-inner shrink-0",
              status === 'success' ? "bg-emerald-500/10" : 
              status === 'error' ? "bg-red-500/10" : "bg-primary/10"
            )}>
              {getStatusIcon()}
            </div>
            <div className="flex flex-col gap-0.5 overflow-hidden">
              <span className={cn(
                "font-semibold truncate",
                status === 'error' ? "text-red-700" : "text-foreground"
              )}>
                {title}
              </span>
              <div className="flex items-center gap-2">
                {getStatusBadge()}
                <span className="text-[10px] text-muted-foreground font-normal">
                  {messages.length} Ereignisse
                </span>
              </div>
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent className="pt-2 pb-4 flex flex-col gap-2">
          <div className="pl-1 space-y-1">
            {messages.map((message, msgIdx) => {
              const shouldAnimate = animatingId === message.id && (!completedAnimations || !completedAnimations.has(message.id));
              
              // Highlight summary message if it matches
              const isSummary = summary && message.content.includes(summary);
              
              return (
                <div
                  key={message.id}
                  className={cn(
                    "animate-fade-in transition-all duration-300",
                    isSummary && "mt-2 pt-2 border-t border-primary/10 bg-primary/5 rounded-lg"
                  )}
                  style={{
                    animationDelay: `${Math.min(msgIdx * 30, 150)}ms`,
                  }}
                >
                  <ChatMessage 
                    message={message} 
                    allMessages={allMessages}
                    onOpenAgentOutput={onOpenAgentOutput}
                    onAction={onAction}
                    enableTypewriter={shouldAnimate}
                    onTypewriterComplete={() => onAnimationComplete?.(message.id)}
                    currentStep={currentStep}
                    isBundled={true}
                  />
                </div>
              );
            })}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

export default TaskExecutionBundle;
