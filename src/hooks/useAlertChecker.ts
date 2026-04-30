'use client';

import { useEffect, useRef, useCallback } from 'react';
import { notification } from 'antd';
import { useStore } from '@/context/StoreContext';
import { PriceAlert, StockQuote } from '@/types';

export function useAlertChecker() {
  const { state, dispatch, fetchAlerts } = useStore();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const checkAlerts = useCallback(async () => {
    const activeAlerts = state.alerts.filter((a) => !a.triggered);
    if (activeAlerts.length === 0) return;

    // Get unique symbols
    const symbols = [...new Set(activeAlerts.map((a) => a.symbol))];

    // Fetch quotes for each symbol
    const quotes: Record<string, StockQuote> = {};
    for (const symbol of symbols) {
      try {
        const res = await fetch(`/api/stock/quote?symbol=${encodeURIComponent(symbol)}`);
        if (res.ok) {
          quotes[symbol] = await res.json();
        }
      } catch (e) {
        console.error(`Alert check failed for ${symbol}:`, e);
      }
    }

    // Check each alert
    for (const alert of activeAlerts) {
      const quote = quotes[alert.symbol];
      if (!quote) continue;

      let triggered = false;

      if (alert.targetPrice != null) {
        if (alert.type === 'above' && quote.currentPrice >= alert.targetPrice) {
          triggered = true;
        } else if (alert.type === 'below' && quote.currentPrice <= alert.targetPrice) {
          triggered = true;
        }
      }

      if (alert.targetPercent != null) {
        const percentChange = ((quote.currentPrice - alert.referencePrice) / alert.referencePrice) * 100;
        if (alert.type === 'above' && percentChange >= alert.targetPercent) {
          triggered = true;
        } else if (alert.type === 'below' && percentChange <= -Math.abs(alert.targetPercent)) {
          triggered = true;
        }
      }

      if (triggered) {
        await triggerAlert(alert, quote);
      }
    }
  }, [state.alerts]);

  const triggerAlert = async (alert: PriceAlert, quote: StockQuote) => {
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
    const threshold = alert.targetPrice != null
      ? `$${alert.targetPrice.toFixed(2)}`
      : `${alert.targetPercent}%`;

    notification.open({
      message: `${direction} Alert: ${alert.symbol}`,
      description: `${alert.symbol} is now at $${quote.currentPrice.toFixed(2)} — crossed ${threshold} threshold!`,
      type: alert.type === 'above' ? 'success' : 'warning',
      duration: 10,
      placement: 'topRight',
    });

    dispatch({ type: 'ADD_TRIGGERED_ALERT', payload: { ...alert, triggered: true } });
    fetchAlerts(); // Refresh alerts list
  };

  useEffect(() => {
    // Check alerts every 60 seconds
    checkAlerts();
    intervalRef.current = setInterval(checkAlerts, 60000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkAlerts]);
}
