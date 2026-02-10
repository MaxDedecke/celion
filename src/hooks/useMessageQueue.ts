import { useCallback, useEffect, useRef, useState } from "react";

interface UseMessageQueueOptions {
  delayMs?: number;
}

export const useMessageQueue = <T extends { id: string; role?: string; created_at?: string }>(
  allMessages: T[],
  options: UseMessageQueueOptions = {}
) => {
  const { delayMs = 300 } = options;
  
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const [animatingId, setAnimatingId] = useState<string | null>(null);
  const [completedAnimations, setCompletedAnimations] = useState<Set<string>>(new Set());
  const queueRef = useRef<string[]>([]);
  const previousIdsRef = useRef<Set<string>>(new Set());
  
  // Ref to track if we have done the initial load.
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
    // Wenn keine Nachrichten da sind (z.B. beim Wechsel der Migration), Initialisierung zurücksetzen
    if (allMessages.length === 0) {
      isInitializedRef.current = false;
      setVisibleIds(new Set());
      setCompletedAnimations(new Set());
      setAnimatingId(null);
      previousIdsRef.current = new Set();
      queueRef.current = [];
      return;
    }

    const currentIds = new Set(allMessages.map(m => m.id));
    // Check for NEW messages (not in previous render)
    const newMessages = allMessages.filter(m => !previousIdsRef.current.has(m.id));

    // Case 1: Initial Load
    // If not initialized yet, we treat ALL currently present messages as history -> Show instantly, no animation.
    if (!isInitializedRef.current) {
        const idsToShowInstantly: string[] = [];
        
        allMessages.forEach(m => {
             idsToShowInstantly.push(m.id);
        });

        setVisibleIds(new Set([...visibleIds, ...idsToShowInstantly]));
        setCompletedAnimations(new Set([...completedAnimations, ...idsToShowInstantly]));
        
        previousIdsRef.current = currentIds;
        isInitializedRef.current = true;
        return;
    }

    // Case 2: Update during session (new messages arriving)
    if (newMessages.length > 0) {
      newMessages.forEach(m => {
        // Prevent duplicate queuing if somehow id is already in queue
        if (!queueRef.current.includes(m.id)) {
             queueRef.current.push(m.id);
        }
      });
      
      // Start processing if not already animating
      if (!animatingId && queueRef.current.length > 0) {
        const nextId = queueRef.current.shift();
        if (nextId) {
          setVisibleIds(prev => new Set([...prev, nextId]));
          setAnimatingId(nextId);
        }
      }
    }
    
    previousIdsRef.current = currentIds;
  }, [allMessages, animatingId]); // Re-run when messages change or animation status changes

  // Sicherheits-Timeout: Falls Animation nicht innerhalb von 30 Sekunden abgeschlossen wird
  useEffect(() => {
    if (animatingId === null) return;
    
    const timeoutId = setTimeout(() => {
      console.warn(`[MessageQueue] Animation timeout for message ${animatingId}, forcing completion`);
      onAnimationComplete(animatingId);
    }, 30000);
    
    return () => clearTimeout(timeoutId);
  }, [animatingId, onAnimationComplete]);

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
