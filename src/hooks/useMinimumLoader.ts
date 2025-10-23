import { useEffect, useRef, useState } from "react";

/**
 * Ensures a loading indicator remains visible for a minimum duration
 * to prevent flicker when async operations resolve quickly.
 */
export const useMinimumLoader = (active: boolean, minVisibleMs = 0) => {
  const [isVisible, setIsVisible] = useState(active);
  const startRef = useRef<number | null>(active ? Date.now() : null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (active) {
      startRef.current = Date.now();
      setIsVisible(true);
      return;
    }

    if (startRef.current && minVisibleMs > 0) {
      const elapsed = Date.now() - startRef.current;
      const remaining = minVisibleMs - elapsed;

      if (remaining > 0) {
        timeoutRef.current = setTimeout(() => {
          setIsVisible(false);
          startRef.current = null;
        }, remaining);
        return;
      }
    }

    startRef.current = null;
    setIsVisible(false);
  }, [active, minVisibleMs]);

  useEffect(
    () => () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  return isVisible;
};

export default useMinimumLoader;
