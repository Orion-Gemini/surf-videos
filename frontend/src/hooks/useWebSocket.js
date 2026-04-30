import { useEffect, useRef, useCallback } from "react";
import { BACKEND_URL } from "../api";

export function useWebSocket(roomId, token, handlers) {
  const wsRef = useRef(null);

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!roomId || !token) return;

    let cancelled = false;
    const wsUrl = BACKEND_URL.replace(/^http/, "ws");
    const ws = new WebSocket(`${wsUrl}/ws/rooms/${roomId}?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;

    ws.onopen = () => { if (!cancelled) handlersRef.current.onOpen?.(); };
    ws.onclose = (e) => { if (!cancelled) handlersRef.current.onClose?.(e); };
    ws.onerror = () => { if (!cancelled) handlersRef.current.onError?.(); };
    ws.onmessage = (e) => {
      if (cancelled) return;
      try {
        const data = JSON.parse(e.data);
        handlersRef.current.onMessage?.(data);
      } catch { /* invalid json */ }
    };

    return () => {
      cancelled = true;
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.onopen = () => ws.close(1000);
      } else {
        ws.close(1000);
      }
    };
  }, [roomId, token]);

  return { send };
}
