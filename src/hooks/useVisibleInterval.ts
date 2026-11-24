'use client';

import { useEffect, useRef } from 'react';

/**
 * `setInterval` that only fires while the page is on screen.
 *
 * Every tick of a price poll is a billed server request. Browsers keep timers
 * running in background tabs (Chrome only slows them to once a minute), so an
 * unguarded poll in a forgotten tab runs all day. Here a hidden page skips its
 * ticks, and catches up with one immediate run when it is shown again — but only
 * if a full `delay` has passed since the last run.
 *
 * The caller does its own first load on mount; this only schedules the repeats.
 */
export function useVisibleInterval(callback: () => void, delay: number, enabled = true) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    let lastRun = Date.now();
    const run = () => {
      lastRun = Date.now();
      callbackRef.current();
    };

    const interval = setInterval(() => {
      if (!document.hidden) run();
    }, delay);

    const onVisibilityChange = () => {
      if (!document.hidden && Date.now() - lastRun >= delay) run();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [delay, enabled]);
}
