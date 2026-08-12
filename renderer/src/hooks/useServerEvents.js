import { useEffect, useRef } from 'react';
import { serverEvents } from '../api/serverEvents.js';

// Subscribe a screen to real-time server push events (see
// renderer/src/api/serverEvents.js). Bursts are coalesced: a flurry of events
// — e.g. a bulk import firing one per row — is collected and the handler is
// called once, ~debounceMs after the last one, with the whole array. That way
// the screen refetches a single time instead of N times.
//
// The handler can change every render (it usually closes over state like the
// current filters or selected id); it's read through a ref so the latest one
// always runs without re-subscribing.
export function useServerEvents(handler, { debounceMs = 200 } = {}) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let timer = null;
    let batch = [];

    const unsubscribe = serverEvents.subscribe((event) => {
      batch.push(event);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const events = batch;
        batch = [];
        handlerRef.current(events);
      }, debounceMs);
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [debounceMs]);
}
