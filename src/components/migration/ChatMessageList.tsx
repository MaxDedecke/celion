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
  <div className="flex w-fit animate-fade-in gap-3 rounded-2xl border border-accent/30 bg-accent/10 p-3">
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20">
      <div className="flex gap-1">
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/70" style={{ animationDelay: "0ms" }} />
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/70" style={{ animationDelay: "150ms" }} />
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent/70" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
    <div className="flex items-center">
      <p className="text-sm text-muted-foreground">Agent arbeitet...</p>
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
