import { useEffect, useLayoutEffect, useRef } from "react";
import { RutubePlayerController } from "./RutubePlayerController";

/**
 * Creates and manages a RutubePlayerController tied to an iframe ref.
 *
 * @param {React.RefObject} iframeRef - ref to the Rutube embed iframe
 * @param {boolean}         active    - set false to skip/destroy the controller (e.g. while join overlay is shown)
 * @param {object}          handlers  - event callbacks; always read via ref so closures stay fresh
 *   handlers.onReady()
 *   handlers.onDuration(data)
 *   handlers.onCurrentTime(data)
 *   handlers.onPlay()
 *   handlers.onPause()
 */
export function usePlayer(iframeRef, active = true, handlers = {}) {
  const handlersRef = useRef(handlers);
  // Sync after DOM mutations but before paint — avoids "ref during render" lint rule
  useLayoutEffect(() => { handlersRef.current = handlers; });

  const controllerRef = useRef(null);

  useEffect(() => {
    if (!active || !iframeRef.current) return;

    const ctrl = new RutubePlayerController(iframeRef.current);
    controllerRef.current = ctrl;

    // Stable wrappers so we can unsubscribe exactly the same function reference
    const onReady       = ()  => handlersRef.current.onReady?.();
    const onDuration    = (d) => handlersRef.current.onDuration?.(d);
    const onCurrentTime = (d) => handlersRef.current.onCurrentTime?.(d);
    const onPlay        = ()  => handlersRef.current.onPlay?.();
    const onPause       = ()  => handlersRef.current.onPause?.();

    ctrl.on("player:ready",         onReady);
    ctrl.on("player:durationChange", onDuration);
    ctrl.on("player:currentTime",    onCurrentTime);
    ctrl.on("player:play",           onPlay);
    ctrl.on("player:pause",          onPause);

    return () => {
      ctrl.destroy();
      controllerRef.current = null;
    };
  }, [iframeRef, active]);

  return { controllerRef };
}
