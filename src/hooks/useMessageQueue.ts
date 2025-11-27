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
    
    // Neue Nachrichten erkennen (nur gegen previousIdsRef prüfen, nicht visibleIds - vermeidet Race Condition)
    const newIds = allMessages.filter(m => !previousIdsRef.current.has(m.id));
    
    // Bulk-Load Erkennung: Mehr als 3 neue Nachrichten = historische Daten, sofort anzeigen
    const isBulkLoad = newIds.length > 3;
    
    if (!isInitializedRef.current || isBulkLoad) {
      // Alle Nachrichten sofort sichtbar und als completed markieren
      setVisibleIds(currentIds);
      setCompletedAnimations(currentIds);
      previousIdsRef.current = currentIds;
      isInitializedRef.current = true;
      // Queue leeren falls etwas drin war
      queueRef.current = [];
      return;
    }
    
    // Ab hier: Nur einzelne neue Nachrichten während der Session animieren
    if (newIds.length > 0) {
      newIds.forEach(m => {
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
  }, [allMessages, animatingId]);

  // Sicherheits-Timeout: Falls Animation nicht innerhalb von 10 Sekunden abgeschlossen wird
  useEffect(() => {
    if (animatingId === null) return;
    
    const timeoutId = setTimeout(() => {
      console.warn(`[MessageQueue] Animation timeout for message ${animatingId}, forcing completion`);
      onAnimationComplete(animatingId);
    }, 10000);
    
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
