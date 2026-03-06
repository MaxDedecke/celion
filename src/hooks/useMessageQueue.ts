import { useCallback, useEffect, useRef, useState } from "react";

interface UseMessageQueueOptions {
  delayMs?: number;
}

export const useMessageQueue = <T extends { id: string; role?: string; created_at?: string }>(
  allMessages: T[],
  options: UseMessageQueueOptions = {}
) => {
  const { delayMs = 600 } = options; // Increased default delay
  
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const [animatingId, setAnimatingId] = useState<string | null>(null);
  const [completedAnimations, setCompletedAnimations] = useState<Set<string>>(new Set());
  
  const queueRef = useRef<string[]>([]);
  // Use processedIdsRef instead of previousIdsRef to ensure we never re-evaluate or skip queued items
  const processedIdsRef = useRef<Set<string>>(new Set());
  
  // Ref to track if we have done the initial load.
  const isInitializedRef = useRef(false);

  const processNextInQueue = useCallback(() => {
    if (queueRef.current.length > 0) {
      const nextId = queueRef.current.shift();
      if (nextId) {
        setVisibleIds(prev => new Set([...prev, nextId]));
        setAnimatingId(nextId);
      }
    } else {
      setAnimatingId(null);
    }
  }, []);

  // Callback wenn Animation fertig ist
  const onAnimationComplete = useCallback((messageId: string) => {
    setCompletedAnimations(prev => new Set([...prev, messageId]));
    setAnimatingId(null);
    
    // Nächste Nachricht aus Queue holen (mit kleiner Verzögerung)
    setTimeout(() => {
      processNextInQueue();
    }, delayMs);
  }, [delayMs, processNextInQueue]);

  useEffect(() => {
    // Wenn keine Nachrichten da sind (z.B. beim Wechsel der Migration), Initialisierung zurücksetzen
    if (allMessages.length === 0) {
      isInitializedRef.current = false;
      setVisibleIds(new Set());
      setCompletedAnimations(new Set());
      setAnimatingId(null);
      processedIdsRef.current = new Set();
      queueRef.current = [];
      return;
    }

    // Case 1: Initial Load
    // If not initialized yet, we treat ALL currently present messages as history -> Show instantly, no animation.
    if (!isInitializedRef.current) {
        const idsToShowInstantly: string[] = [];
        
        allMessages.forEach(m => {
             idsToShowInstantly.push(m.id);
             processedIdsRef.current.add(m.id);
        });

        setVisibleIds(new Set([...visibleIds, ...idsToShowInstantly]));
        setCompletedAnimations(new Set([...completedAnimations, ...idsToShowInstantly]));
        
        isInitializedRef.current = true;
        return;
    }

    // Case 2: Update during session (new messages arriving)
    // ONLY look at messages we haven't processed (queued or shown) yet
    const newMessages = allMessages.filter(m => !processedIdsRef.current.has(m.id));

    if (newMessages.length > 0) {
      let addedToQueue = false;
      newMessages.forEach(m => {
        if (!queueRef.current.includes(m.id)) {
             queueRef.current.push(m.id);
             processedIdsRef.current.add(m.id);
             addedToQueue = true;
        }
      });
      
      // Start processing if not already animating
      if (addedToQueue && animatingId === null) {
          processNextInQueue();
      }
    }
  }, [allMessages, animatingId, processNextInQueue]);

  // Sicherheits-Timeout: Falls Animation nicht innerhalb von 60 Sekunden abgeschlossen wird
  useEffect(() => {
    if (animatingId === null) return;
    
    const timeoutId = setTimeout(() => {
      console.warn(`[MessageQueue] Animation timeout for message ${animatingId}, forcing completion`);
      onAnimationComplete(animatingId);
    }, 60000); // Increased timeout to 60s
    
    return () => clearTimeout(timeoutId);
  }, [animatingId, onAnimationComplete]);

  const visibleMessages = allMessages.filter(m => visibleIds.has(m.id));
  const isProcessing = queueRef.current.length > 0 || animatingId !== null;

  return {
    visibleMessages, 
    isProcessing,
    animatingId,
    completedAnimations,
    onAnimationComplete
  };
};
