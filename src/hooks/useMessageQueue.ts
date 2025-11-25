import { useEffect, useRef, useState } from "react";

interface UseMessageQueueOptions {
  delayMs?: number;
}

export const useMessageQueue = <T extends { id: string }>(
  allMessages: T[],
  options: UseMessageQueueOptions = {}
) => {
  const { delayMs = 1000 } = options;
  
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previousIdsRef = useRef<Set<string>>(new Set());
  const isInitializedRef = useRef(false);

  useEffect(() => {
    const currentIds = new Set(allMessages.map(m => m.id));
    
    // Beim ersten Render alle existierenden Nachrichten sofort sichtbar machen
    if (!isInitializedRef.current && allMessages.length > 0) {
      setVisibleIds(currentIds);
      previousIdsRef.current = currentIds;
      isInitializedRef.current = true;
      return;
    }
    
    // Nur neue Nachrichten nach Initialisierung queuen
    const newIds = allMessages
      .filter(m => !previousIdsRef.current.has(m.id) && !visibleIds.has(m.id))
      .map(m => m.id);
    
    if (newIds.length > 0) {
      queueRef.current.push(...newIds);
    }
    
    previousIdsRef.current = currentIds;
  }, [allMessages, visibleIds]);

  useEffect(() => {
    if (queueRef.current.length > 0 && !intervalRef.current) {
      const firstId = queueRef.current.shift();
      if (firstId) {
        setVisibleIds(prev => new Set([...prev, firstId]));
      }
      
      intervalRef.current = setInterval(() => {
        const nextId = queueRef.current.shift();
        if (nextId) {
          setVisibleIds(prev => new Set([...prev, nextId]));
        }
        
        if (queueRef.current.length === 0 && intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }, delayMs);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [allMessages, delayMs]);

  const visibleMessages = allMessages.filter(m => visibleIds.has(m.id));
  const hasQueuedMessages = queueRef.current.length > 0;

  return { visibleMessages, hasQueuedMessages };
};
