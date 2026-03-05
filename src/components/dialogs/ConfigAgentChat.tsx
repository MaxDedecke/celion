import { useState, useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import ChatMessage, { type ChatMessage as ChatMessageType } from "@/components/migration/ChatMessage";
import ChatInput from "@/components/migration/ChatInput";
import type { NewMigrationInput } from "@/types/migration";
import { steps, type ChatConfig } from "@/constants/configAgentSteps";

interface ConfigAgentChatProps {
  onComplete: (config: NewMigrationInput) => void;
  onCancel: () => void;
  onStepChange?: (step: number, total: number) => void;
  initialData?: Partial<NewMigrationInput>;
}

const ConfigAgentChat = ({ onComplete, onCancel, onStepChange, initialData }: ConfigAgentChatProps) => {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [config, setConfig] = useState<ChatConfig>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Initialize from initialData if provided
  useEffect(() => {
    if (initialData) {
      setConfig({
        name: initialData.name,
        sourceSystem: initialData.sourceSystem,
        sourceUrl: initialData.sourceUrl,
        targetSystem: initialData.targetSystem,
        targetUrl: initialData.targetUrl,
        sourceApiToken: initialData.sourceAuth?.apiToken,
        sourceEmail: initialData.sourceAuth?.email,
        targetApiToken: initialData.targetAuth?.apiToken,
        targetEmail: initialData.targetAuth?.email,
        sourceScope: initialData.scopeConfig?.sourceScope,
        targetScope: initialData.scopeConfig?.targetName
      });
    }
  }, [initialData]);

  const addMessage = (role: "assistant" | "user", content: string) => {
    const newMessage: ChatMessageType = {
      id: crypto.randomUUID(),
      role,
      content,
      created_at: new Date().toISOString(),
      status: "success",
    };
    setMessages((prev) => [...prev, newMessage]);
  };

  // Initial greeting
  useEffect(() => {
    if (messages.length === 0) {
      addMessage("assistant", steps[0].question);
      onStepChange?.(1, steps.length);
    }
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages]);

  const handleSend = async (text: string) => {
    addMessage("user", text);
    setIsProcessing(true);

    // Simulate "thinking" delay
    await new Promise(resolve => setTimeout(resolve, 600));

    const currentStep = steps[currentStepIndex];

    if (currentStep.key === "confirmation") {
      if (["ja", "yes"].includes(text.toLowerCase())) {
        addMessage("assistant", "Perfekt! Die Migration wird angelegt.");
        
        // Construct final object
        const finalConfig: NewMigrationInput = {
            name: config.name!,
            sourceSystem: config.sourceSystem!,
            sourceUrl: config.sourceUrl!,
            targetSystem: config.targetSystem!,
            targetUrl: config.targetUrl!,
            sourceAuth: {
                authType: "token",
                apiToken: config.sourceApiToken!,
                email: config.sourceEmail!,
            },
            targetAuth: {
                authType: "token",
                apiToken: config.targetApiToken!,
                email: config.targetEmail!,
            },
            scopeConfig: {
                sourceScope: config.sourceScope,
                targetName: config.targetScope
            }
        };
        
        setTimeout(() => onComplete(finalConfig), 1000);
      } else {
        addMessage("assistant", "Abgebrochen. Du kannst das Fenster schließen oder 'restart' tippen, um neu zu beginnen.");
      }
      setIsProcessing(false);
      return;
    }

    // Validation
    if (currentStep.validate) {
      const error = currentStep.validate(text);
      if (error) {
        addMessage("assistant", error);
        setIsProcessing(false);
        return;
      }
    }

    // Process & Store
    let value: any = text;
    if (currentStep.process) {
      value = currentStep.process(text);
    }

    const updatedConfig = { ...config, [currentStep.key]: value };
    setConfig(updatedConfig);

    // Next Step
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStepIndex(nextIndex);
      onStepChange?.(nextIndex + 1, steps.length);
      const nextStep = steps[nextIndex];
      
      let question = nextStep.question;
      if (nextStep.key === "confirmation") {
        question = `Ich habe folgende Konfiguration erfasst:

**Name:** ${updatedConfig.name}
**Quelle:** ${updatedConfig.sourceSystem} (${updatedConfig.sourceUrl})
**Ziel:** ${updatedConfig.targetSystem} (${updatedConfig.targetUrl || '...'})

Alles korrekt? (ja/nein)`;
      }
      
      addMessage("assistant", question);
    }

    setIsProcessing(false);
  };

  return (
    <div className="flex flex-col h-[600px] w-full max-w-5xl mx-auto bg-background rounded-lg overflow-hidden">
      <div className="flex-1 overflow-hidden p-4 relative" ref={scrollAreaRef}>
         <ScrollArea className="h-full pr-4">
            <div className="space-y-4 pb-4">
              {messages.map((msg) => (
                <ChatMessage key={msg.id} message={msg} allMessages={messages} />
              ))}
            </div>
         </ScrollArea>
      </div>
      <div className="p-4 border-t bg-muted/20">
        <ChatInput 
          onSend={handleSend} 
          disabled={isProcessing || currentStepIndex >= steps.length && steps[currentStepIndex]?.key !== 'confirmation'} 
          placeholder={steps[currentStepIndex]?.options ? `Wähle z.B. ${steps[currentStepIndex].options![0]}...` : "Antwort eingeben..."}
        />
      </div>
    </div>
  );
};

export default ConfigAgentChat;