import { useEffect } from "react";
import ChatMessage, { ChatMessage as ChatMessageType } from "./ChatMessage";
import { cn } from "@/lib/utils";
import { useMessageQueue } from "@/hooks/useMessageQueue";

interface ChatMessageListProps {
  messages: ChatMessageType[];
  isAgentRunning: boolean;
  onOpenAgentOutput?: (stepId: string) => void;
}

const TypingIndicator = () => (
  <div className="flex w-fit animate-fade-in items-center gap-2 py-2 pl-3">
    <div className="flex gap-1.5">
      <div 
        className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" 
        style={{ animationDelay: "0ms", animationDuration: "1s" }} 
      />
      <div 
        className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" 
        style={{ animationDelay: "150ms", animationDuration: "1s" }} 
      />
      <div 
        className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" 
        style={{ animationDelay: "300ms", animationDuration: "1s" }} 
      />
    </div>
  </div>
);

const ChatMessageList = ({ messages, isAgentRunning, onOpenAgentOutput }: ChatMessageListProps) => {
  const { visibleMessages, hasQueuedMessages } = useMessageQueue(messages, {
    delayMs: 1000,
  });

  return (
    <div className="flex flex-col gap-3 pb-4 pr-3">
      {visibleMessages.map((message, index) => (
        <div
          key={message.id}
          style={{
            animationDelay: `${index * 50}ms`,
          }}
        >
          <ChatMessage message={message} onOpenAgentOutput={onOpenAgentOutput} />
        </div>
      ))}
      {(isAgentRunning || hasQueuedMessages) && <TypingIndicator />}
    </div>
  );
};

export default ChatMessageList;
