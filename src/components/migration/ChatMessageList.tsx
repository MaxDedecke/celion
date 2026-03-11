import { useEffect, useMemo } from "react";
import ChatMessage, { ChatMessage as ChatMessageType } from "./ChatMessage";
import { useMessageQueue } from "@/hooks/useMessageQueue";
import { Brain } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface ChatMessageListProps {
  messages: ChatMessageType[];
  isAgentRunning: boolean;
  isConsultantThinking?: boolean;
  onOpenAgentOutput?: (stepId: string) => void;
  onAction?: (action: string) => void;
  onProcessingChange?: (isProcessing: boolean) => void;
  showContinueButton?: boolean;
  onContinue?: () => void;
  continueButtonText?: string;
  currentStepTitle?: string;
  currentStep?: number;
}

const ThinkingIndicator = ({ stepTitle, role = "agent" }: { stepTitle?: string, role?: "agent" | "consultant" }) => (
  <div className="flex items-start gap-3 py-3 animate-fade-in pl-2">
    <div className="h-8 w-8 flex items-center justify-center">
      <Brain className="h-4 w-4 text-primary animate-pulse" />
    </div>
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground font-medium">
        Denke nach ...
      </span>
      <div className="flex gap-1.5">
        <div
          className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce"
          style={{ animationDelay: "0ms", animationDuration: "1s" }}
        />        <div 
          className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce" 
          style={{ animationDelay: "150ms", animationDuration: "1s" }} 
        />
        <div 
          className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce" 
          style={{ animationDelay: "300ms", animationDuration: "1s" }} 
        />
      </div>
    </div>
  </div>
);

const ChatMessageList = ({ 
  messages, 
  isAgentRunning, 
  isConsultantThinking,
  onOpenAgentOutput,
  onAction,
  onProcessingChange,
  onContinue,
  currentStepTitle,
  currentStep
}: ChatMessageListProps) => {
  const { 
    visibleMessages, 
    isProcessing,
    animatingId,
    completedAnimations,
    onAnimationComplete
  } = useMessageQueue(messages, {
    delayMs: 300,
  });

  useEffect(() => {
    onProcessingChange?.(isProcessing);
  }, [isProcessing, onProcessingChange]);

  const handleAction = (action: string) => {
    if (onAction) {
      onAction(action);
    } else if (action === 'continue' && onContinue) {
      onContinue();
    }
  };

  // Find the latest action message to pin it to the bottom
  const actionMessages = messages.filter(m => {
    const content = m.content.trim();
    
    // Check for direct JSON match
    if (content.startsWith('{') && content.endsWith('}')) {
      try {
        const parsed = JSON.parse(content);
        return parsed.type === 'action';
      } catch { /* skip */ }
    }

    // Check for markdown code blocks
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      try {
        const json = JSON.parse(codeBlockMatch[1]);
        return json.type === 'action';
      } catch { /* skip */ }
    }

    // Check for JSON embedded in text
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        const potentialJson = content.substring(firstBrace, lastBrace + 1);
        const json = JSON.parse(potentialJson);
        return json.type === 'action';
      } catch { /* skip */ }
    }

    return false;
  });
  const lastActionMessage = actionMessages[actionMessages.length - 1];

  const groupedItems = useMemo(() => {
    const items: any[] = [];
    let currentAttemptChunk: ChatMessageType[] = [];
    let currentStepNumber = -1;
    let attemptCounter = 1;

    // Helper to check if a message looks like a "Start of Step" message
    const isStartMarker = (msg: ChatMessageType) => {
      if (msg.role !== 'assistant') return false;
      const content = msg.content.trim();
      return (
        content.startsWith("Starte **") ||
        content.startsWith("Analysiere **") ||
        content.startsWith("Bereite **") ||
        content.startsWith("Prüfe **") ||
        content.startsWith("Erstelle **") ||
        content.startsWith("Führe **") ||
        content.includes("Celion Onboarding Agent") ||
        content.includes("Lass uns deine Migration einrichten") ||
        content.includes("Bereite Daten für das Mapping vor") ||
        content.includes("Starte Datentransfer") ||
        content.includes("führe Mapping-Verifizierung durch") ||
        content.includes("Erstelle Migrations-Plan")
      );
    };

    visibleMessages.forEach((msg, idx) => {
      const step = msg.step_number ?? currentStepNumber;
      
      // Detect if this is a new attempt within the SAME step
      // This happens if we see a start marker and we already have messages in the current chunk
      const isNewAttemptStart = step === currentStepNumber && 
                               currentAttemptChunk.length > 0 && 
                               isStartMarker(msg);

      if (step !== currentStepNumber || isNewAttemptStart) {
        if (currentAttemptChunk.length > 0) {
          // If it was a retry or we are starting a new attempt/step, group the previous chunk if it's not the last one
          // or if it was specifically a failed attempt.
          // For now, if we are starting a NEW ATTEMPT in the same step, we definitely group the old ones.
          if (isNewAttemptStart) {
            items.push({
              id: `attempt-${currentAttemptChunk[0].id}-${idx}`,
              type: 'attempt_group',
              messages: [...currentAttemptChunk],
              step_number: currentStepNumber,
              attemptNumber: attemptCounter
            });
            attemptCounter++;
          } else {
            // New step number - just flush previous messages as single messages
            // (Unless they were already grouped by a retry action)
            currentAttemptChunk.forEach(m => items.push({ type: 'single', message: m }));
            attemptCounter = 1;
          }
          currentAttemptChunk = [];
        }
        currentStepNumber = step;
      }
      
      currentAttemptChunk.push(msg);
      
      let isRetryAction = false;
      const contentStr = msg.content.trim();
      
      const checkRetry = (parsed: any) => {
        if (parsed?.action?.includes('retry')) return true;
        if (parsed?.type === 'action') {
          if (parsed.action?.includes('retry')) return true;
          if (Array.isArray(parsed.actions) && parsed.actions.some((a: any) => a.action?.includes('retry'))) return true;
        }
        return false;
      };

      if ((msg.role === 'assistant' || msg.role === 'user') && (contentStr.toLowerCase().includes('retry') || contentStr.toLowerCase().includes('wiederholen'))) {
        if (contentStr.startsWith('{') && contentStr.endsWith('}')) {
          try {
            const parsed = JSON.parse(contentStr);
            isRetryAction = checkRetry(parsed);
          } catch (e) {}
        } else if (contentStr.includes('```')) {
          const match = contentStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          if (match) {
            try {
              const parsed = JSON.parse(match[1]);
              isRetryAction = checkRetry(parsed);
            } catch (e) {}
          }
        } else if (msg.role === 'user' && (contentStr.toLowerCase() === 'wiederholen' || contentStr.toLowerCase().includes('schritt wiederholen'))) {
          isRetryAction = true;
        }
      }
      
      if (isRetryAction) {
        items.push({
          id: `attempt-${msg.id}`,
          type: 'attempt_group',
          messages: [...currentAttemptChunk],
          step_number: currentStepNumber,
          attemptNumber: attemptCounter
        });
        currentAttemptChunk = [];
        attemptCounter++;
      }
    });

    if (currentAttemptChunk.length > 0) {
      currentAttemptChunk.forEach(m => items.push({ type: 'single', message: m }));
    }
    
    return items;
  }, [visibleMessages]);

  return (
    <div className="flex flex-col gap-2 pb-4 pr-3">
      {groupedItems.map((item, index) => {
        if (item.type === 'attempt_group') {
          return (
            <Accordion key={item.id} type="single" collapsible className="w-full">
              <AccordionItem value="item-1" className="border border-primary/10 bg-primary/5 rounded-xl px-4 overflow-hidden mb-2 animate-fade-in">
                <AccordionTrigger className="py-3 hover:no-underline text-sm font-medium text-muted-foreground flex items-center gap-2">
                  Fehlgeschlagener Versuch {item.attemptNumber} (Schritt {item.step_number})
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4 flex flex-col gap-2">
                  {item.messages.map((message: ChatMessageType, msgIdx: number) => {
                    const shouldAnimate = animatingId === message.id && !completedAnimations.has(message.id);
                    return (
                      <div
                        key={message.id}
                        className="animate-fade-in"
                        style={{
                          animationDelay: `${Math.min(msgIdx * 30, 150)}ms`,
                        }}
                      >
                        <ChatMessage 
                          message={message} 
                          allMessages={messages}
                          onOpenAgentOutput={onOpenAgentOutput}
                          onAction={handleAction}
                          enableTypewriter={shouldAnimate}
                          onTypewriterComplete={() => onAnimationComplete(message.id)}
                          currentStep={currentStep}
                        />
                      </div>
                    );
                  })}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          );
        }

        const message = item.message;
        const shouldAnimate = animatingId === message.id && !completedAnimations.has(message.id);

        // Only skip the LATEST action message if it's NOT currently being animated.
        // If it's being animated, we MUST render it so the animation/typewriter can complete and trigger the next message.
        if (lastActionMessage && message.id === lastActionMessage.id && !shouldAnimate) {
          return null;
        }
        
        // Determine if we should show a divider
        const previousItem = index > 0 ? groupedItems[index - 1] : null;
        let previousStepNumber = null;
        if (previousItem) {
           previousStepNumber = previousItem.type === 'single' ? previousItem.message.step_number : previousItem.step_number;
        }
        
        // Divider logic: only for real step transitions where both have a valid step_number
        const showDivider = previousItem && 
                            message.step_number !== undefined && 
                            message.step_number !== null &&
                            previousStepNumber !== undefined &&
                            previousStepNumber !== null &&
                            message.step_number !== previousStepNumber &&
                            message.step_number > 0;

        return (
          <div key={message.id}>
            {showDivider && (
              <div className="flex items-center gap-4 my-4">
                <div className="h-px bg-border flex-1" />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Schritt {message.step_number}
                </span>
                <div className="h-px bg-border flex-1" />
              </div>
            )}
            <div
              className="animate-fade-in"
              style={{
                animationDelay: `${Math.min(index * 30, 150)}ms`,
              }}
            >
              <ChatMessage 
                message={message} 
                allMessages={messages}
                onOpenAgentOutput={onOpenAgentOutput}
                onAction={handleAction}
                enableTypewriter={shouldAnimate}
                onTypewriterComplete={() => onAnimationComplete(message.id)}
                currentStep={currentStep}
              />
            </div>
          </div>
        );
      })}
      
      {isAgentRunning && (
        <ThinkingIndicator stepTitle={currentStepTitle} role="agent" />
      )}

      {isConsultantThinking && !isAgentRunning && (
        <ThinkingIndicator role="consultant" />
      )}
    </div>
  );
};

export default ChatMessageList;