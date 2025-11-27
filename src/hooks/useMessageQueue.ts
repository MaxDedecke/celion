import { useCallback, useEffect, useRef, useState } from "react";

interface UseMessageQueueOptions {
  delayMs?: number;
}

export const useMessageQueue = <T extends { id: string; role?: string }>(
  allMessages: T[],
  options: UseMessageQueueOptions = {}
) => {
  const { delayMs = 300 } = options;
  
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const [animatingId, setAnimatingId] = useState<string | null>(null);
  const [completedAnimations, setCompletedAnimations] = useState<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);
  const previousIdsRef = useRef<Set<string>>(new Set());
  const isInitializedRef = useRef(false);

  // Callback wenn Animation fertig ist
  const onAnimationComplete = useCallback((messageId: string) => {
    setCompletedAnimations(prev => new Set([...prev, messageId]));
    setAnimatingId(null);
    
    // Nächste Nachricht aus Queue holen (mit kleiner Verzögerung)
    setTimeout(() => {
      const nextId = queueRef.current.shift();
      if (nextId) {
        setVisibleIds(prev => new Set([...prev, nextId]));
        setAnimatingId(nextId);
      }
    }, delayMs);
  }, [delayMs]);

  useEffect(() => {
    const currentIds = new Set(allMessages.map(m => m.id));
    
    // Beim ersten Render alle existierenden Nachrichten sofort sichtbar machen
    // und als "completed" markieren (keine Animation für historische Nachrichten)
    if (!isInitializedRef.current && allMessages.length > 0) {
      setVisibleIds(currentIds);
      setCompletedAnimations(currentIds); // Alle historischen als completed markieren
      previousIdsRef.current = currentIds;
      isInitializedRef.current = true;
      return;
    }
    
    // Nur neue Nachrichten nach Initialisierung queuen
    const newMessages = allMessages.filter(
      m => !previousIdsRef.current.has(m.id) && !visibleIds.has(m.id)
    );
    
    if (newMessages.length > 0) {
      newMessages.forEach(m => {
        // Non-agent messages sofort anzeigen und als completed markieren
        if (m.role !== "agent") {
          setVisibleIds(prev => new Set([...prev, m.id]));
          setCompletedAnimations(prev => new Set([...prev, m.id]));
        } else {
          // Agent messages in Queue
          queueRef.current.push(m.id);
        }
      });
      
      // Erste Agent-Nachricht starten wenn keine Animation läuft
      if (!animatingId && queueRef.current.length > 0) {
        const firstId = queueRef.current.shift();
        if (firstId) {
          setVisibleIds(prev => new Set([...prev, firstId]));
          setAnimatingId(firstId);
        }
      }
    }
    
    previousIdsRef.current = currentIds;
  }, [allMessages, visibleIds, animatingId]);

  const visibleMessages = allMessages.filter(m => visibleIds.has(m.id));
  const hasQueuedMessages = queueRef.current.length > 0 || animatingId !== null;

  return { 
    visibleMessages, 
    hasQueuedMessages,
    animatingId,
    completedAnimations,
    onAnimationComplete
  };
};
