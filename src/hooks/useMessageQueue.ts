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
      return;
    }

    const currentIds = new Set(allMessages.map(m => m.id));
    
    // Neue Nachrichten erkennen (nur gegen previousIdsRef prüfen)
    const newMessages = allMessages.filter(m => !previousIdsRef.current.has(m.id));
    
    // Erst-Initialisierung oder Bulk-Load von historischen Daten
    if (!isInitializedRef.current || newMessages.length > 3) {
      const now = Date.now();
      const idsToAnimate: string[] = [];
      const idsToShowInstantly: string[] = [];

      allMessages.forEach(m => {
        // Nachricht ist "neu", wenn sie jünger als 10 Sekunden ist
        const isVeryRecent = m.created_at ? (now - new Date(m.created_at).getTime() < 10000) : false;
        
        if (isVeryRecent && isInitializedRef.current) {
          // Nur während der Session animieren
          idsToAnimate.push(m.id);
        } else {
          idsToShowInstantly.push(m.id);
        }
      });

      setVisibleIds(new Set([...visibleIds, ...idsToShowInstantly]));
      setCompletedAnimations(new Set([...completedAnimations, ...idsToShowInstantly]));
      
      if (idsToAnimate.length > 0) {
        queueRef.current.push(...idsToAnimate);
      }

      previousIdsRef.current = currentIds;
      isInitializedRef.current = true;

      // Starten falls nichts läuft
      if (!animatingId && queueRef.current.length > 0) {
        const nextId = queueRef.current.shift();
        if (nextId) {
          setVisibleIds(prev => new Set([...prev, nextId]));
          setAnimatingId(nextId);
        }
      }
      return;
    }
    
    // Ab hier: Einzelne neue Nachrichten während der Session animieren (z.B. User-Input oder Agenten-Antwort)
    if (newMessages.length > 0) {
      newMessages.forEach(m => {
        queueRef.current.push(m.id);
      });
      
      if (!animatingId && queueRef.current.length > 0) {
        const firstId = queueRef.current.shift();
        if (firstId) {
          setVisibleIds(prev => new Set([...prev, firstId]));
          setAnimatingId(firstId);
        }
      }
    }
    
    previousIdsRef.current = currentIds;
  }, [allMessages, animatingId]);

  // Sicherheits-Timeout: Falls Animation nicht innerhalb von 10 Sekunden abgeschlossen wird
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
