import ChatMessage, { ChatMessage as ChatMessageType } from "./ChatMessage";
import { cn } from "@/lib/utils";
import { useMessageQueue } from "@/hooks/useMessageQueue";
import { Sparkles, ArrowRight } from "lucide-react";

interface ChatMessageListProps {
  messages: ChatMessageType[];
  isAgentRunning: boolean;
  onOpenAgentOutput?: (stepId: string) => void;
  showContinueButton?: boolean;
  onContinue?: () => void;
  continueButtonText?: string;
  currentStepTitle?: string;
}

const ThinkingIndicator = ({ stepTitle }: { stepTitle?: string }) => (
  <div className="flex items-start gap-3 py-3 animate-fade-in pl-2">
    <div className="h-8 w-8 flex items-center justify-center">
      <Sparkles className="h-4 w-4 text-primary animate-pulse" />
    </div>
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-muted-foreground">
        {stepTitle ? `Analysiere ${stepTitle}...` : "Denke nach..."}
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
  onOpenAgentOutput, 
  showContinueButton = false,
  onContinue,
  continueButtonText = "Fortsetzen",
  currentStepTitle
}: ChatMessageListProps) => {
  const { 
    visibleMessages, 
    hasQueuedMessages,
    animatingId,
    completedAnimations,
    onAnimationComplete
  } = useMessageQueue(messages, {
    delayMs: 400,
  });

  return (
    <div className="flex flex-col gap-2 pb-4 pr-3">
      {visibleMessages.map((message, index) => {
        const isLastMessage = index === visibleMessages.length - 1;
        const shouldAnimate = animatingId === message.id && !completedAnimations.has(message.id);
        
        // Determine if we should show a divider
        const previousMessage = index > 0 ? visibleMessages[index - 1] : null;
        const isStepStart = message.content.startsWith("Starting Step") || message.content.startsWith("Starting System Detection"); // Add specific starts if needed
        
        const showDivider = previousMessage && (
          (message.step_number && previousMessage.step_number !== message.step_number) ||
          (isStepStart && message.role === 'system')
        );

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
                onOpenAgentOutput={onOpenAgentOutput}
                enableTypewriter={shouldAnimate}
                onTypewriterComplete={() => onAnimationComplete(message.id)}
              />
            </div>
          </div>
        );
      })}
      
      {showContinueButton && !isAgentRunning && (!hasQueuedMessages || messages.length === 0) && (
        <div className="flex items-center gap-2 animate-fade-in pt-4 pl-11">
          <button 
            onClick={onContinue}
            className="text-sm text-primary hover:text-primary/80 flex items-center gap-1.5 transition-all group"
          >
            <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
            {continueButtonText}
          </button>
        </div>
      )}
      
      {(isAgentRunning || hasQueuedMessages) && (
        <ThinkingIndicator stepTitle={currentStepTitle} />
      )}
    </div>
  );
};

export default ChatMessageList;
