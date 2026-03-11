import { useState, useEffect, useRef } from 'react';

export interface MigrationEvent {
  migration_id: string;
  type: string;
  data: any;
  timestamp: string;
}

export function useMigrationWebSocket(migrationId: string | undefined) {
  const [lastEvent, setLastEvent] = useState<MigrationEvent | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!migrationId) return;

    let ws: WebSocket;
    let reconnectTimeout: NodeJS.Timeout;

    const connect = () => {
      // Determine the correct WebSocket protocol based on the current window protocol
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = import.meta.env.VITE_API_URL 
        ? new URL(import.meta.env.VITE_API_URL).host 
        : window.location.host;
      
      const wsUrl = `${protocol}//${host}/api/v1/ws/migrations/${migrationId}`;
      
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`[WebSocket] Connected to migration ${migrationId}`);
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data: MigrationEvent = JSON.parse(event.data);
          setLastEvent(data);
        } catch (e) {
          console.error('[WebSocket] Failed to parse message', e);
        }
      };

      ws.onclose = () => {
        console.log(`[WebSocket] Disconnected from migration ${migrationId}`);
        setIsConnected(false);
        // Automatic reconnect after 3 seconds
        reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.onerror = (error) => {
        console.error('[WebSocket] Error', error);
        ws.close();
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [migrationId]);

  return { lastEvent, isConnected };
}
