import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import ChatMessage, { type ChatMessage as ChatMessageType } from "@/components/migration/ChatMessage";
import ChatInput from "@/components/migration/ChatInput";
import { DATA_SOURCE_TYPE_OPTIONS } from "@/constants/sourceTypes";
import type { NewMigrationInput } from "@/types/migration";

interface ConfigAgentChatProps {
  onComplete: (config: NewMigrationInput) => void;
  onCancel: () => void;
  initialData?: Partial<NewMigrationInput>;
}

type StepKey = 
  | "name"
  | "sourceSystem"
  | "sourceUrl"
  | "sourceApiToken"
  | "sourceEmail"
  | "sourceScope"
  | "targetSystem"
  | "targetUrl"
  | "targetApiToken"
  | "targetEmail"
  | "targetScope"
  | "confirmation";

interface StepConfig {
  key: StepKey;
  question: string;
  validate?: (value: string) => string | null; // Returns error message or null
  process?: (value: string) => any;
  options?: readonly string[];
}

const ConfigAgentChat = ({ onComplete, onCancel, initialData }: ConfigAgentChatProps) => {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [config, setConfig] = useState<Partial<NewMigrationInput>>(initialData || {});
  const [isProcessing, setIsProcessing] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

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

  const steps: StepConfig[] = [
    {
      key: "name",
      question: "Hallo! Ich bin dein Konfigurations-Assistent. Lass uns deine Migration einrichten. Wie soll sie heißen?",
      validate: (val) => val.trim().length > 0 ? null : "Der Name darf nicht leer sein.",
    },
    {
      key: "sourceSystem",
      question: `Welches ist das Quellsystem? (z.B. ${DATA_SOURCE_TYPE_OPTIONS.slice(0, 3).join(", ")}...)`,
      validate: (val) => DATA_SOURCE_TYPE_OPTIONS.includes(val as any) ? null : "Bitte wähle ein gültiges System aus der Liste.",
      options: DATA_SOURCE_TYPE_OPTIONS,
    },
    {
      key: "sourceUrl",
      question: "Wie lautet die URL des Quellsystems?",
      validate: (val) => {
        try {
          new URL(val);
          return null;
        } catch {
          return "Bitte gib eine gültige URL ein (inkl. https://).";
        }
      },
    },
    {
      key: "sourceApiToken",
      question: "Bitte gib den API Token für das Quellsystem ein.",
      validate: (val) => val.trim().length > 0 ? null : "Der Token darf nicht leer sein.",
    },
    {
      key: "sourceEmail",
      question: "Welche E-Mail-Adresse gehört zu diesem Token?",
      validate: (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) ? null : "Bitte gib eine gültige E-Mail-Adresse ein.",
    },
    {
      key: "sourceScope",
      question: "Möchtest du die Migration auf ein bestimmtes Projekt beschränken? Gib die ID oder den Namen ein (oder 'skip' für alles).",
      process: (val) => val.toLowerCase() === "skip" ? undefined : val,
    },
    {
      key: "targetSystem",
      question: "Nun zum Zielsystem. Welches System ist das Ziel?",
      validate: (val) => DATA_SOURCE_TYPE_OPTIONS.includes(val as any) ? null : "Bitte wähle ein gültiges System aus der Liste.",
      options: DATA_SOURCE_TYPE_OPTIONS,
    },
    {
      key: "targetUrl",
      question: "Wie lautet die URL des Zielsystems?",
      validate: (val) => {
        try {
          new URL(val);
          return null;
        } catch {
          return "Bitte gib eine gültige URL ein (inkl. https://).";
        }
      },
    },
    {
      key: "targetApiToken",
      question: "Bitte gib den API Token für das Zielsystem ein.",
      validate: (val) => val.trim().length > 0 ? null : "Der Token darf nicht leer sein.",
    },
    {
      key: "targetEmail",
      question: "Und die E-Mail-Adresse für das Zielsystem?",
      validate: (val) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val) ? null : "Bitte gib eine gültige E-Mail-Adresse ein.",
    },
    {
      key: "targetScope",
      question: "Wie soll das Projekt im Zielsystem heißen? (Optional, 'skip' um den Quellnamen zu behalten).",
      process: (val) => val.toLowerCase() === "skip" ? undefined : val,
    },
    {
      key: "confirmation",
      question: "Ich habe alle Daten. Möchtest du die Migration jetzt anlegen? (ja/nein)",
      validate: (val) => ["ja", "nein", "yes", "no"].includes(val.toLowerCase()) ? null : "Bitte antworte mit 'ja' oder 'nein'.",
    }
  ];

  // Initial greeting
  useEffect(() => {
    if (messages.length === 0) {
      addMessage("assistant", steps[0].question);
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
                <ChatMessage key={msg.id} message={msg} />
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
        <div className="mt-2 text-xs text-muted-foreground flex justify-between">
           <span>Schritt {Math.min(currentStepIndex + 1, steps.length)} von {steps.length}</span>
           <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onCancel}>Abbrechen</Button>
        </div>
      </div>
    </div>
  );
};

export default ConfigAgentChat;
