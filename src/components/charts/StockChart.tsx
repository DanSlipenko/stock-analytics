'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Spin } from 'antd';
import { StockCandle } from '@/types';

type ChartTime = import('lightweight-charts').Time;
type ChartMarker = import('lightweight-charts').SeriesMarker<ChartTime>;

export type ChartAlertRule = {
  id?: string;
  type: 'above' | 'below';
  targetPrice?: number;
  targetPercent?: number;
  referencePrice: number;
  createdAt?: string;
};

interface StockChartProps {
  symbol: string;
  height?: number;
  hideToolbar?: boolean;
  activeRangeOverride?: TimeRange;
  chartType?: 'candlestick' | 'area';
  markers?: ChartMarker[];
  alertRules?: ChartAlertRule[];
}

type TradeOverlayMarker = {
  key: string;
  x: number;
  y: number;
  labelY: number;
  side: 'buy' | 'sell';
  label: string;
  price: number;
  color: string;
};

export type TimeRange = '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL';

export const TIME_RANGES: { key: TimeRange; label: string; seconds: number }[] = [
  { key: '1W', label: '1W', seconds: 7 * 86400 },
  { key: '1M', label: '1M', seconds: 30 * 86400 },
  { key: '3M', label: '3M', seconds: 90 * 86400 },
  { key: '6M', label: '6M', seconds: 180 * 86400 },
  { key: '1Y', label: '1Y', seconds: 365 * 86400 },
  { key: 'ALL', label: 'ALL', seconds: 5 * 365 * 86400 },
];

const parseTradeMarker = (marker: ChartMarker) => {
  const match = marker.text?.match(/^(Buy|Sell)\s*@\s*\$?([\d,.]+)/i);
  if (!match) return null;

  const price = Number(match[2].replace(/,/g, ''));
  if (!Number.isFinite(price)) return null;

  const side = match[1].toLowerCase() as 'buy' | 'sell';
  return {
    side,
    price,
    label: `${side.toUpperCase()} $${price.toFixed(2)}`,
    color: side === 'buy' ? '#22c55e' : '#ef4444',
  };
};

const normalizeMarkers = (markers: ChartMarker[] | undefined, validTimes: Set<string>): ChartMarker[] => {
  if (!markers?.length || validTimes.size === 0) return [];

  return markers
    .map((marker) => {
      if (validTimes.has(String(marker.time))) return marker;

      let closest = Array.from(validTimes)[0];
      let minDiff = Infinity;
      const markerTime = new Date(String(marker.time)).getTime();

      for (const validTime of validTimes) {
        const diff = Math.abs(new Date(validTime).getTime() - markerTime);
        if (diff < minDiff) {
          minDiff = diff;
          closest = validTime;
        }
      }

      return { ...marker, time: closest as ChartTime };
    })
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
};

const getDisplayMarkers = (markers: ChartMarker[] | undefined, validTimes: Set<string>): ChartMarker[] =>
  normalizeMarkers(markers, validTimes).map((marker) => {
    const tradeMarker = parseTradeMarker(marker);
    if (!tradeMarker) return marker;

    return {
      ...marker,
      position: 'atPriceMiddle',
      price: tradeMarker.price,
      color: tradeMarker.color,
      shape: 'circle',
      size: 0.65,
      text: undefined,
    } as ChartMarker;
  });

const getAlertTargetPrice = (rule: ChartAlertRule) => {
  if (rule.targetPrice != null) return rule.targetPrice;
  if (rule.targetPercent == null) return null;

  const multiplier = rule.type === 'above'
    ? 1 + rule.targetPercent / 100
    : 1 - rule.targetPercent / 100;
  const targetPrice = rule.referencePrice * multiplier;

  return targetPrice > 0 ? targetPrice : null;
};

const getAlertLabel = (rule: ChartAlertRule, targetPrice: number) => {
  const direction = rule.type === 'above' ? 'Above' : 'Below';
  const target = rule.targetPrice != null
    ? `$${targetPrice.toFixed(2)}`
    : `${rule.targetPercent}%`;

  return `${direction} ${target}`;
};

const getAlertTriggerMarkers = (
  rules: ChartAlertRule[] | undefined,
  candles: StockCandle[]
): ChartMarker[] => {
  if (!rules?.length || candles.length === 0) return [];

  return rules.flatMap((rule) => {
    const targetPrice = getAlertTargetPrice(rule);
    if (targetPrice == null) return [];

    const createdAtMs = rule.createdAt ? new Date(rule.createdAt).getTime() : NaN;
    if (!Number.isFinite(createdAtMs)) return [];

    const triggerCandle = candles.find((candle) => (
      Number(candle.time) * 1000 >= createdAtMs
      && (
        rule.type === 'above'
          ? candle.high >= targetPrice
          : candle.low <= targetPrice
      )
    ));

    if (!triggerCandle) return [];

    const d = new Date(Number(triggerCandle.time) * 1000);
    const timeStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

    return [{
      time: timeStr as unknown as ChartTime,
      position: rule.type === 'above' ? 'aboveBar' : 'belowBar',
      color: rule.type === 'above' ? '#f59e0b' : '#ef4444',
      shape: rule.type === 'above' ? 'arrowDown' : 'arrowUp',
      text: getAlertLabel(rule, targetPrice),
    } as ChartMarker];
  });
};

export default function StockChart({ symbol, height = 400, hideToolbar = false, activeRangeOverride, chartType = 'candlestick', markers, alertRules }: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof import('lightweight-charts').createChart> | null>(null);
  const seriesRef = useRef<import('lightweight-charts').ISeriesApi<'Candlestick'> | import('lightweight-charts').ISeriesApi<'Area'> | null>(null);
  const markersPluginRef = useRef<any>(null);
  const priceLineRefs = useRef<any[]>([]);
  const dataTimesRef = useRef<Set<string>>(new Set());
  const candlesRef = useRef<StockCandle[]>([]);
  const markersRef = useRef(markers);
  const alertRulesRef = useRef(alertRules);
  const cleanupChartListenersRef = useRef<(() => void) | null>(null);
  const [loading, setLoading] = useState(true);
  const [noData, setNoData] = useState(false);
  const [internalRange, setInternalRange] = useState<TimeRange>('1Y');
  const [tradeOverlays, setTradeOverlays] = useState<TradeOverlayMarker[]>([]);
  
  // Overlay state
  const [tooltip, setTooltip] = useState<{
    show: boolean;
    x: number;
    y: number;
    date: string;
    price: number;
    percentChange: number;
    isDragging: boolean;
    dragPercent: number | null;
  }>({
    show: false,
    x: 0,
    y: 0,
    date: '',
    price: 0,
    percentChange: 0,
    isDragging: false,
    dragPercent: null,
  });

  const dragStartRef = useRef<{ price: number; time: any } | null>(null);

  const activeRange = activeRangeOverride || internalRange;
  markersRef.current = markers;
  alertRulesRef.current = alertRules;

  const resetChart = useCallback(() => {
    cleanupChartListenersRef.current?.();
    cleanupChartListenersRef.current = null;
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }
    seriesRef.current = null;
    markersPluginRef.current = null;
    priceLineRefs.current = [];
    dataTimesRef.current = new Set();
    candlesRef.current = [];
    setTradeOverlays([]);
  }, []);

  const syncAlertPriceLines = useCallback(() => {
    if (!seriesRef.current) return;

    priceLineRefs.current.forEach((priceLine) => {
      try {
        seriesRef.current?.removePriceLine(priceLine);
      } catch {
        // Lightweight Charts can throw if the series was already disposed.
      }
    });
    priceLineRefs.current = [];

    alertRulesRef.current?.forEach((rule) => {
      const targetPrice = getAlertTargetPrice(rule);
      if (targetPrice == null || !seriesRef.current) return;

      const color = rule.type === 'above' ? '#f59e0b' : '#ef4444';
      const priceLine = seriesRef.current.createPriceLine({
        price: targetPrice,
        color,
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: getAlertLabel(rule, targetPrice),
      });

      priceLineRefs.current.push(priceLine);
    });
  }, []);

  const updateTradeOverlays = useCallback(() => {
    if (!chartRef.current || !seriesRef.current || dataTimesRef.current.size === 0) {
      setTradeOverlays([]);
      return;
    }

    const chart = chartRef.current;
    const series = seriesRef.current;
    const normalizedMarkers = normalizeMarkers(markersRef.current, dataTimesRef.current);

    const nextTradeOverlays = normalizedMarkers.flatMap((marker, index) => {
      const tradeMarker = parseTradeMarker(marker);
      if (!tradeMarker) return [];

      const x = chart.timeScale().timeToCoordinate(marker.time);
      const y = series.priceToCoordinate(tradeMarker.price);
      if (x === null || y === null) return [];

      return [{
        key: `${String(marker.time)}-${tradeMarker.side}-${index}`,
        x,
        y,
        labelY: Math.min(Math.max(y, 24), height - 24),
        side: tradeMarker.side,
        label: tradeMarker.label,
        price: tradeMarker.price,
        color: tradeMarker.color,
      }];
    });

    setTradeOverlays(nextTradeOverlays);
  }, [height]);

  const loadChart = useCallback(async (range: TimeRange) => {
    if (!containerRef.current) return;

    setLoading(true);
    setNoData(false);

    const now = Math.floor(Date.now() / 1000);
    const rangeConfig = TIME_RANGES.find((r) => r.key === range)!;
    const from = now - rangeConfig.seconds;

    try {
      const res = await fetch(
        `/api/stock/candles?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${now}`
      );

      if (!res.ok) throw new Error('Failed to fetch candles');
      const data = await res.json();
      const candles: StockCandle[] = data.candles || [];

      if (candles.length === 0) {
        resetChart();
        setNoData(true);
        setLoading(false);
        return;
      }

      // Dynamic import for SSR safety
      const { createChart, ColorType, CrosshairMode, CandlestickSeries, AreaSeries, HistogramSeries, createSeriesMarkers } = await import('lightweight-charts');

      // Dispose old chart
      resetChart();

      const chart = createChart(containerRef.current, {
        width: containerRef.current.clientWidth,
        height: height,
        layout: {
          background: { type: ColorType.Solid, color: '#111827' },
          textColor: '#94a3b8',
          fontFamily: "'Inter', sans-serif",
          fontSize: 12,
        },
        grid: {
          vertLines: { color: '#1e2a3a40' },
          horzLines: { color: '#1e2a3a40' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: '#00d4aa40', width: 1, style: 2 },
          horzLine: { color: '#00d4aa40', width: 1, style: 2 },
        },
        rightPriceScale: {
          borderColor: '#1e2a3a',
          scaleMargins: { top: 0.1, bottom: 0.2 },
        },
        timeScale: {
          borderColor: '#1e2a3a',
          timeVisible: true,
          secondsVisible: false,
          fixLeftEdge: true,
          fixRightEdge: true,
        },
      });

      chartRef.current = chart;

      candlesRef.current = candles;

      let unsubscribeVisibleRange: (() => void) | null = null;

      if (candles.length > 0) {
        let mainSeries;
        
        if (chartType === 'area') {
          mainSeries = chart.addSeries(AreaSeries, {
            lineColor: '#ef4444', // Red line to match user's screenshot, or we can make it dynamic based on price
            topColor: '#ef444440',
            bottomColor: '#ef444400',
            lineWidth: 2,
          });
        } else {
          mainSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#22c55e',
            downColor: '#ef4444',
            borderDownColor: '#ef4444',
            borderUpColor: '#22c55e',
            wickDownColor: '#ef444480',
            wickUpColor: '#22c55e80',
          });
        }

        const validTimes = new Set<string>();
        const mappedCandles = candles.map((c) => {
          const d = new Date(Number(c.time) * 1000);
          const timeStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
          validTimes.add(timeStr);
          
          if (chartType === 'area') {
            return {
              time: timeStr as unknown as import('lightweight-charts').Time,
              value: c.close,
            };
          } else {
            return {
              time: timeStr as unknown as import('lightweight-charts').Time,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
            };
          }
        });
        
        mainSeries.setData(mappedCandles as any);
        seriesRef.current = mainSeries as any;
        dataTimesRef.current = validTimes;

        // Apply compact chart markers immediately if they exist.
        const validMarkers = getDisplayMarkers(markersRef.current, validTimes);
        const alertMarkers = getAlertTriggerMarkers(alertRulesRef.current, candles);
        const chartMarkers = [...validMarkers, ...alertMarkers]
          .sort((a, b) => String(a.time).localeCompare(String(b.time)));

        if (chartMarkers.length > 0) {
          try {
            const markersPlugin = createSeriesMarkers(mainSeries as any, chartMarkers);
            markersPluginRef.current = markersPlugin;
          } catch (e) {
            console.error('[StockChart] Markers set error:', e);
          }
        }
        syncAlertPriceLines();

        // Volume series
        const volumeSeries = chart.addSeries(HistogramSeries, {
          color: '#00d4aa30',
          priceFormat: { type: 'volume' },
          priceScaleId: '',
        });

        volumeSeries.priceScale().applyOptions({
          scaleMargins: { top: 0.8, bottom: 0 },
        });

        volumeSeries.setData(
          candles.map((c) => {
            const d = new Date(Number(c.time) * 1000);
            const timeStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
            return {
              time: timeStr as unknown as import('lightweight-charts').Time,
              value: c.volume,
              color: c.close >= c.open ? '#22c55e20' : '#ef444420',
            };
          })
        );

        // Subscribe to crosshair move
        const firstPrice = candles[0]?.open || 0;
        
        chart.subscribeCrosshairMove((param) => {
          if (!param.time || !param.point || param.point.x < 0) {
            setTooltip(prev => ({ ...prev, show: false }));
            return;
          }

          const price = param.seriesData.get(mainSeries) as any;
          if (!price) return;

          const currentPrice = chartType === 'area' ? price.value : price.close;
          const percentChange = firstPrice > 0 ? ((currentPrice - firstPrice) / firstPrice) * 100 : 0;

          let dragPercent = null;
          if (dragStartRef.current) {
            dragPercent = ((currentPrice - dragStartRef.current.price) / dragStartRef.current.price) * 100;
          }

          setTooltip({
            show: true,
            x: param.point.x,
            y: param.point.y,
            date: param.time.toString(),
            price: currentPrice,
            percentChange,
            isDragging: !!dragStartRef.current,
            dragPercent,
          });
        });

        const handleVisibleRangeChange = () => updateTradeOverlays();
        chart.timeScale().subscribeVisibleTimeRangeChange(handleVisibleRangeChange);
        unsubscribeVisibleRange = () => chart.timeScale().unsubscribeVisibleTimeRangeChange(handleVisibleRangeChange);
        chart.timeScale().fitContent();
        requestAnimationFrame(updateTradeOverlays);
      }

      // Handle resize
      const handleResize = () => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
          requestAnimationFrame(updateTradeOverlays);
        }
      };

      window.addEventListener('resize', handleResize);
      cleanupChartListenersRef.current = () => {
        window.removeEventListener('resize', handleResize);
        unsubscribeVisibleRange?.();
      };

      setLoading(false);
    } catch (error) {
      console.error('Chart load error:', error);
      resetChart();
      setNoData(true);
      setLoading(false);
    }
  }, [symbol, height, chartType, syncAlertPriceLines, updateTradeOverlays, resetChart]);

  useEffect(() => {
    loadChart(activeRange);

    return () => {
      resetChart();
    };
  }, [activeRange, loadChart, resetChart]);

  // Update markers without recreating the entire chart
  useEffect(() => {
    if (seriesRef.current && dataTimesRef.current.size > 0) {
      try {
        const validMarkers = getDisplayMarkers(markers, dataTimesRef.current);
        const alertMarkers = getAlertTriggerMarkers(alertRules, candlesRef.current);
        const chartMarkers = [...validMarkers, ...alertMarkers]
          .sort((a, b) => String(a.time).localeCompare(String(b.time)));
        syncAlertPriceLines();

        if (markersPluginRef.current) {
          markersPluginRef.current.setMarkers(chartMarkers);
        } else if (chartMarkers.length > 0) {
          // Fallback if plugin wasn't created yet
          import('lightweight-charts').then(({ createSeriesMarkers }) => {
            if (seriesRef.current) {
              markersPluginRef.current = createSeriesMarkers(seriesRef.current, chartMarkers);
            }
          });
        }
        updateTradeOverlays();
      } catch (e) {
        console.error('[StockChart] Markers effect error:', e);
      }
    } else {
      setTradeOverlays([]);
    }
  }, [alertRules, markers, syncAlertPriceLines, updateTradeOverlays]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!tooltip.show) return;
    dragStartRef.current = { price: tooltip.price, time: tooltip.date };
    setTooltip(prev => ({ ...prev, isDragging: true }));
  };

  const handleMouseUp = () => {
    dragStartRef.current = null;
    setTooltip(prev => ({ ...prev, isDragging: false, dragPercent: null }));
  };

  return (
    <div 
      className="chart-container" 
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {!hideToolbar && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{symbol} Chart</span>
          <div className="time-range-group">
            {TIME_RANGES.map((r) => (
              <button
                key={r.key}
                className={`time-range-btn ${activeRange === r.key ? 'active' : ''}`}
                onClick={() => setInternalRange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{ position: 'relative' }}>
        {loading && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 10 }}>
            <Spin size="large" />
          </div>
        )}
        <div ref={containerRef} style={{ minHeight: noData ? height : undefined }} />
        {noData && !loading && (
          <div style={{
            position: 'absolute',
            inset: 0,
            minHeight: height,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            color: '#64748b',
            fontSize: 13,
            textAlign: 'center',
            padding: 24,
          }}>
            <span style={{ color: '#94a3b8', fontWeight: 700 }}>No chart data available</span>
            <span>Check the symbol or choose a different result.</span>
          </div>
        )}
        {tradeOverlays.map((marker) => {
          const labelLeft = marker.x < 120 ? 12 : undefined;
          const labelRight = marker.x >= 120 ? 12 : undefined;

          return (
            <div
              key={marker.key}
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: marker.x,
                zIndex: 4,
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  borderLeft: `2px dashed ${marker.color}cc`,
                  boxShadow: `0 0 12px ${marker.color}55`,
                  transform: 'translateX(-1px)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: marker.y,
                  left: 0,
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: marker.color,
                  border: '2px solid #111827',
                  boxShadow: `0 0 0 3px ${marker.color}33, 0 0 14px ${marker.color}99`,
                  transform: 'translate(-50%, -50%)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: marker.labelY,
                  left: labelLeft,
                  right: labelRight,
                  transform: 'translateY(-50%)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 8px',
                  borderRadius: 999,
                  background: 'rgba(17, 24, 39, 0.92)',
                  border: `1px solid ${marker.color}99`,
                  color: marker.color,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 0.4,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.45)',
                }}
              >
                <span>{marker.side === 'buy' ? 'B' : 'S'}</span>
                <span>{marker.label}</span>
              </div>
            </div>
          );
        })}
        
        {/* Legend / Tooltip Overlay */}
        {tooltip.show && (
          <div style={{
            position: 'absolute',
            top: 12,
            left: 12,
            zIndex: 5,
            pointerEvents: 'none',
            background: 'rgba(15, 22, 41, 0.8)',
            backdropFilter: 'blur(4px)',
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #1e2a3a',
            fontSize: 12,
            color: '#e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
          }}>
            <div style={{ fontWeight: 700, color: '#94a3b8', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
              {tooltip.date}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>${tooltip.price.toFixed(2)}</span>
              <span style={{ 
                color: tooltip.percentChange >= 0 ? '#22c55e' : '#ef4444',
                fontWeight: 600
              }}>
                {tooltip.percentChange >= 0 ? '+' : ''}{tooltip.percentChange.toFixed(2)}%
              </span>
            </div>
            {tooltip.dragPercent !== null && (
              <div style={{ 
                marginTop: 4, 
                paddingTop: 4, 
                borderTop: '1px solid #1e2a3a',
                color: '#00d4aa',
                fontWeight: 600,
                fontSize: 11
              }}>
                Measured: {tooltip.dragPercent >= 0 ? '+' : ''}{tooltip.dragPercent.toFixed(2)}%
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
