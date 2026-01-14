import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface TypewriterTextProps {
  text: string;
  speed?: number; // ms per character
  onComplete?: () => void;
  className?: string;
}

const TypewriterText = ({ 
  text, 
  speed = 30, 
  onComplete,
  className 
}: TypewriterTextProps) => {
  const [displayedText, setDisplayedText] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Reset if text changes significantly (optional, depending on use case)
    if (text.length > 0 && currentIndex === 0 && displayedText === "") {
        // Initial start
    }
  }, [text]);

  useEffect(() => {
    if (currentIndex >= text.length) {
      if (!isComplete) {
        setIsComplete(true);
        onComplete?.();
      }
      return;
    }

    const timer = setTimeout(() => {
      setDisplayedText((prev) => prev + text[currentIndex]);
      setCurrentIndex((prev) => prev + 1);
    }, speed);

    return () => clearTimeout(timer);
  }, [currentIndex, text, speed, isComplete, onComplete]);

  return (
    <span className={cn("whitespace-pre-wrap", className)}>
      {displayedText}
      {!isComplete && (
        <span className="inline-block w-1.5 h-4 ml-0.5 bg-primary animate-pulse align-middle" />
      )}
    </span>
  );
};

export default TypewriterText;