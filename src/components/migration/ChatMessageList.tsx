import { useEffect, useMemo } from "react";
import ChatMessage, { ChatMessage as ChatMessageType } from "./ChatMessage";
import TaskExecutionBundle from "./TaskExecutionBundle";
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

// Helper functions moved outside to be accessible everywhere
function isStartMarker(msg: ChatMessageType) {
  if (msg.role !== 'assistant') return false;
  const content = msg.content.trim();
  
  // Generic start markers (German and English)
  if (content.startsWith("Starte Schritt")) return true;
  if (content.startsWith("Starting Step")) return true;
  if (content.startsWith("Starting Schritt")) return true;
  if (content.startsWith("Fortsetzung Schritt")) return true;
  if (content.startsWith("Fortsetzung Step")) return true;
  if (content.startsWith("Prüfe **Mapping-Verifizierung**")) return true;
  
  // The worker sends messages like "Starting System Detection..." or "Starting Authentication Flow..."
  if (content.startsWith("Starting ") && (
    content.includes("Detection") || 
    content.includes("Flow") || 
    content.includes("Discovery") || 
    content.includes("Generation") || 
    content.includes("Staging") || 
    content.includes("Fetching") || 
    content.includes("Transformation") || 
    content.includes("Loading") || 
    content.includes("Validation") || 
    content.includes("Cleanup")
  )) return true;

  // Also support German translations if they ever appear
  if (content.startsWith("Starte ") && (
    content.includes("Erkennung") || 
    content.includes("Authentifizierung") || 
    content.includes("Entdeckung") || 
    content.includes("Schema") || 
    content.includes("Staging") || 
    content.includes("Abruf") || 
    content.includes("Transformation") || 
    content.includes("Laden") || 
    content.includes("Validierung") || 
    content.includes("Bereinigung")
  )) return true;
  
  // Fallback markers for Onboarding (Step 0) or other special agents
  return (
    content.includes("Celion Onboarding Agent") ||
    content.includes("Lass uns deine Migration einrichten") ||
    content.includes("Lass uns mit der Einrichtung beginnen")
  );
}

function extractStepTitle(messages: ChatMessageType[]) {
  const firstMsg = messages.find(m => m.role === 'assistant');
  if (!firstMsg) return null;
  
  const content = firstMsg.content.trim();
  // Match pattern like "Starte Schritt 1: **System Detection**..."
  const match = content.match(/(?:Starte|Starting|Fortsetzung)\s+Schritt\s+\d+:\s+\*\*(.*?)\*\*/i);
  if (match) return match[1];
  
  // Match pattern like "Starting System Detection..."
  if (content.startsWith("Starting ") && content.endsWith("...")) {
    return content.substring(9, content.length - 3);
  }
  
  // Match pattern like "Prüfe **Mapping-Verifizierung**..."
  const mappingMatch = content.match(/Prüfe\s+\*\*(.*?)\*\*/i);
  if (mappingMatch) return mappingMatch[1];

  return null;
}

function bundleSubtasks(messages: ChatMessageType[]): any[] {
  const result: any[] = [];
  let currentBundle: {
    type: 'task_bundle';
    id: string;
    title: string;
    messages: ChatMessageType[];
    status: 'success' | 'error' | 'in_progress';
    summary?: string;
    step_number?: number;
  } | null = null;

  messages.forEach((msg) => {
    const content = msg.content.trim();
    const isTaskStart = content.includes("🚀 **Starte Teilaufgabe:**") || content.includes("🚀 Starte Teilaufgabe:");
    const isTaskSuccess = content.includes("✅ **Aufgabe abgeschlossen:**") || content.includes("✅ Aufgabe abgeschlossen:");
    const isTaskFailure = content.includes("❌ **Aufgabe fehlgeschlagen:**") || content.includes("❌ Aufgabe fehlgeschlagen:");

    if (isTaskStart) {
      if (currentBundle) result.push(currentBundle);
      
      // Extract title: remove the prefix and handle potential markdown bolding
      const title = content.replace(/🚀 \*\*Starte Teilaufgabe:\*\*|🚀 Starte Teilaufgabe:/, '').trim();
      
      currentBundle = {
        type: 'task_bundle',
        id: `bundle-${msg.id}`,
        title: title,
        messages: [msg],
        status: 'in_progress',
        step_number: msg.step_number
      };
    } else if (currentBundle) {
      currentBundle.messages.push(msg);
      if (isTaskSuccess) {
        currentBundle.status = 'success';
        currentBundle.summary = content;
        result.push(currentBundle);
        currentBundle = null;
      } else if (isTaskFailure) {
        currentBundle.status = 'error';
        currentBundle.summary = content;
        result.push(currentBundle);
        currentBundle = null;
      }
    } else {
      result.push({ type: 'single', message: msg });
    }
  });

  if (currentBundle) result.push(currentBundle);
  return result;
}

type GroupedItem = 
  | { type: 'single', message: ChatMessageType }
  | { type: 'attempt_group', id: string, messages: ChatMessageType[], step_number: number, attemptNumber: number, title: string | null }
  | { type: 'task_bundle', id: string, title: string, messages: ChatMessageType[], status: 'success' | 'error' | 'in_progress', summary?: string, step_number?: number };

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

    visibleMessages.forEach((msg, idx) => {
      const step = msg.step_number ?? currentStepNumber;
      
      // Detect if this is a new attempt within the SAME step
      const isNewAttemptStart = step >= 0 && 
                               step === currentStepNumber && 
                               currentAttemptChunk.length > 0 && 
                               isStartMarker(msg);

      if (step !== currentStepNumber || isNewAttemptStart) {
        if (currentAttemptChunk.length > 0 && currentStepNumber !== -1) {
          if (isNewAttemptStart) {
            // Group the previous chunk as a failed attempt because a new attempt started in the same step
            const extractedTitle = extractStepTitle(currentAttemptChunk);
            items.push({
              id: `attempt-${currentAttemptChunk[0].id}-${idx}`,
              type: 'attempt_group',
              messages: [...currentAttemptChunk],
              step_number: currentStepNumber,
              attemptNumber: attemptCounter,
              title: extractedTitle
            });
            attemptCounter++;
          } else {
            // Normal step transition. Process chunk for subtasks.
            items.push(...bundleSubtasks(currentAttemptChunk));
            attemptCounter = 1;
          }
          currentAttemptChunk = [];
        }
        currentStepNumber = step;
      }
      
      currentAttemptChunk.push(msg);
    });

    if (currentAttemptChunk.length > 0) {
      items.push(...bundleSubtasks(currentAttemptChunk));
    }
    
    return items;
  }, [visibleMessages]);


  return (
    <div className="flex flex-col gap-2 pb-4 pr-3">
      {groupedItems.map((item, index) => {
        if (item.type === 'attempt_group') {
          return (
            <Accordion key={item.id} type="single" collapsible className="w-full">
              <AccordionItem value="item-1" className="border border-primary/10 bg-primary/5 rounded-xl px-4 overflow-hidden mb-2 animate-fade-in shadow-sm">
                <AccordionTrigger className="py-3 hover:no-underline text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px]">
                    {item.attemptNumber}
                  </div>
                  <span>Fehlgeschlagener Versuch {item.attemptNumber} {item.title ? `(${item.title})` : `(Schritt ${item.step_number})`}</span>
                </AccordionTrigger>
                <AccordionContent className="pt-2 pb-4 flex flex-col gap-2">
                  {bundleSubtasks(item.messages).map((subItem: any, subIdx: number) => {
                    if (subItem.type === 'task_bundle') {
                      return (
                        <TaskExecutionBundle
                          key={subItem.id}
                          id={subItem.id}
                          title={subItem.title}
                          messages={subItem.messages}
                          status={subItem.status}
                          summary={subItem.summary}
                          allMessages={messages}
                          onOpenAgentOutput={onOpenAgentOutput}
                          onAction={handleAction}
                          currentStep={currentStep}
                          animatingId={animatingId}
                          completedAnimations={completedAnimations}
                          onAnimationComplete={onAnimationComplete}
                        />
                      );
                    }

                    const message = subItem.message;
                    const shouldAnimate = animatingId === message.id && !completedAnimations.has(message.id);
                    return (
                      <div
                        key={message.id}
                        className="animate-fade-in"
                        style={{
                          animationDelay: `${Math.min(subIdx * 30, 150)}ms`,
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
                          isBundled={true}
                        />
                      </div>
                    );
                  })}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          );
        }

        if (item.type === 'task_bundle') {
          return (
            <TaskExecutionBundle
              key={item.id}
              id={item.id}
              title={item.title}
              messages={item.messages}
              status={item.status}
              summary={item.summary}
              allMessages={messages}
              onOpenAgentOutput={onOpenAgentOutput}
              onAction={handleAction}
              currentStep={currentStep}
              animatingId={animatingId}
              completedAnimations={completedAnimations}
              onAnimationComplete={onAnimationComplete}
            />
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