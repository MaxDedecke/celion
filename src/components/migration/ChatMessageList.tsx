import { useEffect } from "react";
import ChatMessage, { ChatMessage as ChatMessageType } from "./ChatMessage";
import { useMessageQueue } from "@/hooks/useMessageQueue";
import { Brain } from "lucide-react";

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

  return (
    <div className="flex flex-col gap-2 pb-4 pr-3">
      {visibleMessages.map((message, index) => {
        const shouldAnimate = animatingId === message.id && !completedAnimations.has(message.id);

        // Only skip the LATEST action message if it's NOT currently being animated.
        // If it's being animated, we MUST render it so the animation/typewriter can complete and trigger the next message.
        if (lastActionMessage && message.id === lastActionMessage.id && !shouldAnimate) {
          return null;
        }
        
        // Determine if we should show a divider
        const previousMessage = index > 0 ? visibleMessages[index - 1] : null;
        
        // Divider logic: only for real step transitions where both have a valid step_number
        const showDivider = previousMessage && 
                            message.step_number !== undefined && 
                            message.step_number !== null &&
                            previousMessage.step_number !== undefined &&
                            previousMessage.step_number !== null &&
                            message.step_number !== previousMessage.step_number &&
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