import ChatMessage, { ChatMessage as ChatMessageType } from "./ChatMessage";
import { useMessageQueue } from "@/hooks/useMessageQueue";
import { Brain } from "lucide-react";

interface ChatMessageListProps {
  messages: ChatMessageType[];
  isAgentRunning: boolean;
  isConsultantThinking?: boolean;
  onOpenAgentOutput?: (stepId: string) => void;
  onAction?: (action: string) => void;
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
        {role === "consultant" ? "Consultant denkt nach..." : (stepTitle ? `Analysiere ${stepTitle}...` : "Agent denkt nach...")}
      </span>
      <div className="flex gap-1.5">
        <div 
          className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce" 
          style={{ animationDelay: "0ms", animationDuration: "1s" }} 
        />
        <div 
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
  onContinue,
  currentStepTitle,
  currentStep
}: ChatMessageListProps) => {
  const { 
    visibleMessages, 
    animatingId,
    completedAnimations,
    onAnimationComplete
  } = useMessageQueue(messages, {
    delayMs: 400,
  });

  const handleAction = (action: string) => {
    if (onAction) {
      onAction(action);
    } else if (action === 'continue' && onContinue) {
      onContinue();
    }
  };

  // Find the latest action message to pin it to the bottom
  // ÄNDERUNG: Wir suchen in ALLEN Nachrichten, nicht nur in den sichtbaren.
  // Damit verhindern wir, dass der Fallback-Button erscheint, während die echte Action-Message noch in der Animation-Queue steckt.
  const actionMessages = messages.filter(m => {
    try {
      const parsed = JSON.parse(m.content);
      return parsed.type === 'action';
    } catch {
      return false;
    }
  });
  const lastActionMessage = actionMessages[actionMessages.length - 1];

  return (
    <div className="flex flex-col gap-2 pb-4 pr-3">
      {visibleMessages.map((message, index) => {
        // Only skip the LATEST action message, keep older ones in the flow
        if (lastActionMessage && message.id === lastActionMessage.id) {
          return null;
        }

        const shouldAnimate = animatingId === message.id && !completedAnimations.has(message.id);
        
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