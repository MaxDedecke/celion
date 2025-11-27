import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface TypewriterTextProps {
  text: string;
  speed?: number; // ms per word
  onComplete?: () => void;
  className?: string;
}

const TypewriterText = ({ 
  text, 
  speed = 40, 
  onComplete,
  className 
}: TypewriterTextProps) => {
  const [displayedWords, setDisplayedWords] = useState<string[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  
  const words = text.split(" ");

  useEffect(() => {
    if (displayedWords.length >= words.length) {
      setIsComplete(true);
      onComplete?.();
      return;
    }

    const timer = setTimeout(() => {
      setDisplayedWords(prev => [...prev, words[prev.length]]);
    }, speed);

    return () => clearTimeout(timer);
  }, [displayedWords, words, speed, onComplete]);

  return (
    <span className={cn("", className)}>
      {displayedWords.join(" ")}
      {!isComplete && (
        <span className="inline-block w-0.5 h-4 ml-0.5 bg-primary/60 animate-pulse align-middle" />
      )}
    </span>
  );
};

export default TypewriterText;
