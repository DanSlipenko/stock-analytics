'use client';

import { useEffect, useRef, useCallback } from 'react';
import { notification } from 'antd';
import { useStore } from '@/context/StoreContext';
import { PriceAlert, StockQuote } from '@/types';
import { fetchQuotes, normalizeSymbol } from '@/lib/quoteClient';

/** Check cadence while the app is on screen. */
const VISIBLE_INTERVAL = 60_000;

/** Check cadence in a background tab or minimised app, so alerts still fire
 * without the tab polling every minute all day. Outside US market hours stock
 * quotes are reused for an hour, so most of these checks only reach the server
 * for crypto alerts. */
const BACKGROUND_INTERVAL = 5 * 60_000;

/** Timers drift by a few hundred ms; don't let that skip a whole interval. */
const TIMER_SLACK = 5_000;

/** A visible page polls its own symbols every minute. Accept a quote that recent
 * instead of asking the server again for the same price. */
const SHARED_QUOTE_AGE = VISIBLE_INTERVAL + 30_000;

/** Alerts from the database always carry an id; the fallback only keeps the
 * type checker honest. */
function alertKey(alert: PriceAlert) {
  return alert._id ?? `${alert.symbol}|${alert.type}|${alert.targetPrice ?? ''}|${alert.targetPercent ?? ''}`;
}

function isTriggered(alert: PriceAlert, quote: StockQuote) {
  if (alert.targetPrice != null) {
    if (alert.type === 'above' && quote.currentPrice >= alert.targetPrice) return true;
    if (alert.type === 'below' && quote.currentPrice <= alert.targetPrice) return true;
  }

  if (alert.targetPercent != null) {
    const percentChange = ((quote.currentPrice - alert.referencePrice) / alert.referencePrice) * 100;
    if (alert.type === 'above' && percentChange >= alert.targetPercent) return true;
    if (alert.type === 'below' && percentChange <= -Math.abs(alert.targetPercent)) return true;
  }

  return false;
}

export function useAlertChecker() {
  const { state, dispatch, fetchAlerts } = useStore();
  const alertsRef = useRef(state.alerts);
  const lastCheckRef = useRef(0);
  const checkingRef = useRef(false);
  /** Alerts already announced in this session. If saving `triggered` fails, the
   * reloaded list still shows them active; without this they would re-fire on
   * every check. */
  const notifiedRef = useRef(new Set<string>());

  const triggerAlert = useCallback(
    async (alert: PriceAlert, quote: StockQuote) => {
      // Update in DB
      try {
        await fetch(`/api/alerts/${alert._id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ triggered: true }),
        });
      } catch (e) {
        console.error('Failed to update alert:', e);
      }

      // Show notification
      const direction = alert.type === 'above' ? '📈 Above' : '📉 Below';
      const threshold = alert.targetPrice != null ? `$${alert.targetPrice.toFixed(2)}` : `${alert.targetPercent}%`;

      notification.open({
        message: `${direction} Alert: ${alert.symbol}`,
        description: `${alert.symbol} is now at $${quote.currentPrice.toFixed(2)} — crossed ${threshold} threshold!`,
        type: alert.type === 'above' ? 'success' : 'warning',
        duration: 10,
        placement: 'topRight',
      });

      dispatch({ type: 'ADD_TRIGGERED_ALERT', payload: { ...alert, triggered: true } });
      fetchAlerts(); // Refresh alerts list
    },
    [dispatch, fetchAlerts]
  );

  const checkAlerts = useCallback(async () => {
    if (checkingRef.current) return;

    const activeAlerts = alertsRef.current.filter((a) => !a.triggered && !notifiedRef.current.has(alertKey(a)));
    if (activeAlerts.length === 0) return;

    checkingRef.current = true;
    lastCheckRef.current = Date.now();

    try {
      // One request for every alert symbol that isn't already fresh in the cache.
      const results = await fetchQuotes(
        activeAlerts.map((a) => a.symbol),
        { maxAge: SHARED_QUOTE_AGE }
      );

      for (const alert of activeAlerts) {
        const result = results[normalizeSymbol(alert.symbol)];
        // A stale quote is a fallback after a failed request; don't fire on an old price.
        if (!result?.quote || result.stale) continue;
        if (!isTriggered(alert, result.quote)) continue;

        notifiedRef.current.add(alertKey(alert));
        await triggerAlert(alert, result.quote);
      }
    } finally {
      checkingRef.current = false;
    }
  }, [triggerAlert]);

  // New or changed alerts get checked straight away.
  useEffect(() => {
    alertsRef.current = state.alerts;
    void checkAlerts();
  }, [state.alerts, checkAlerts]);

  useEffect(() => {
    const interval = setInterval(() => {
      const due = document.hidden ? BACKGROUND_INTERVAL : VISIBLE_INTERVAL;
      if (Date.now() - lastCheckRef.current >= due - TIMER_SLACK) void checkAlerts();
    }, VISIBLE_INTERVAL);

    // Coming back to the app: catch up if the last check is older than a minute.
    const onVisibilityChange = () => {
      if (!document.hidden && Date.now() - lastCheckRef.current >= VISIBLE_INTERVAL) void checkAlerts();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [checkAlerts]);
}
