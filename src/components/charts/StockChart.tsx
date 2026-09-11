'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Skeleton } from 'antd';
import { StockCandle } from '@/types';
import { attachChartComparison, type ChartComparison } from './chartComparison';
import TimeRangeFilter from './TimeRangeFilter';
import { TIME_RANGES, type TimeRange } from './timeRanges';

export { TIME_RANGES, type TimeRange } from './timeRanges';

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
  color: string;
};

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

const getNonTradeMarkers = (markers: ChartMarker[] | undefined, validTimes: Set<string>): ChartMarker[] =>
  normalizeMarkers(markers, validTimes).filter((marker) => !parseTradeMarker(marker));

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

const comparisonDate = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC',
});
const comparisonPrice = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const compactPrice = (price: number) => String(Number(price.toFixed(2)));

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
  const [hasRenderedChart, setHasRenderedChart] = useState(false);
  const [noData, setNoData] = useState(false);
  const [internalRange, setInternalRange] = useState<TimeRange>('3M');
  const [tradeOverlays, setTradeOverlays] = useState<TradeOverlayMarker[]>([]);
  const [comparison, setComparison] = useState<ChartComparison | null>(null);
  const comparingRef = useRef(false);
  
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
    setComparison(null);
    comparingRef.current = false;
    dragStartRef.current = null;
    setTooltip(prev => ({ ...prev, show: false, isDragging: false, dragPercent: null }));
    setHasRenderedChart(false);
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
        title: '',
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
        color: tradeMarker.color,
      }];
    });

    setTradeOverlays(nextTradeOverlays);
  }, []);

  const loadChart = useCallback(async (range: TimeRange, signal: AbortSignal) => {
    if (!containerRef.current) return;

    setLoading(true);
    setNoData(false);

    const now = Math.floor(Date.now() / 1000);
    const rangeConfig = TIME_RANGES.find((r) => r.key === range)!;
    const from = now - rangeConfig.seconds;

    try {
      const res = await fetch(
        `/api/stock/candles?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${now}`,
        { signal },
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
      if (signal.aborted || !containerRef.current) return;

      // Dispose old chart
      resetChart();

      const mobileQuery = window.matchMedia('(max-width: 640px)');
      const chart = createChart(containerRef.current, {
        autoSize: true,
        width: containerRef.current.clientWidth,
        height: height,
        layout: {
          background: { type: ColorType.Solid, color: '#111827' },
          textColor: '#94a3b8',
          fontFamily: "'Inter', sans-serif",
          fontSize: mobileQuery.matches ? 10 : 12,
        },
        grid: {
          vertLines: { color: '#1e2a3a40' },
          horzLines: { color: '#1e2a3a40' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
          vertLine: { color: '#f5f5f540', width: 1, style: 2 },
          horzLine: { color: '#f5f5f540', width: 1, style: 2 },
        },
        rightPriceScale: {
          borderColor: '#1e2a3a',
          scaleMargins: { top: 0.1, bottom: 0.2 },
        },
        // Two fingers compare prices; one finger can still pan the chart.
        handleScale: { pinch: false },
        handleScroll: { vertTouchDrag: false },
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
      let cleanupComparison: (() => void) | null = null;
      let updateResponsiveLabels: (() => void) | null = null;

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
        const validMarkers = getNonTradeMarkers(markersRef.current, validTimes);
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
          color: '#f5f5f530',
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

        updateResponsiveLabels = () => {
          const mobile = mobileQuery.matches;
          chart.applyOptions({ layout: { fontSize: mobile ? 10 : 12 } });
          mainSeries.applyOptions({
            priceFormat: mobile
              ? { type: 'custom', minMove: 0.01, formatter: compactPrice, tickmarksFormatter: (prices: number[]) => prices.map(compactPrice) }
              : { type: 'price', minMove: 0.01, precision: 2 },
          });
          volumeSeries.applyOptions({ priceFormat: { type: 'volume', precision: mobile ? 1 : 2 } });
        };
        updateResponsiveLabels();
        mobileQuery.addEventListener('change', updateResponsiveLabels);

        // Subscribe to crosshair move
        const firstPrice = candles[0]?.open || 0;
        
        chart.subscribeCrosshairMove((param) => {
          if (comparingRef.current) return;
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
        cleanupComparison = attachChartComparison(
          containerRef.current, chart, mainSeries, candles, candle => candle.close, setComparison,
          active => {
            comparingRef.current = active;
            dragStartRef.current = null;
            setTooltip(prev => ({ ...prev, show: false, isDragging: false, dragPercent: null }));
          },
        );
      }

      // Follow the container through layout transitions as well as viewport changes.
      chart.timeScale().subscribeSizeChange(updateTradeOverlays);
      cleanupChartListenersRef.current = () => {
        chart.timeScale().unsubscribeSizeChange(updateTradeOverlays);
        if (updateResponsiveLabels) mobileQuery.removeEventListener('change', updateResponsiveLabels);
        cleanupComparison?.();
        unsubscribeVisibleRange?.();
      };

      setHasRenderedChart(true);
      setLoading(false);
    } catch (error) {
      if (signal.aborted) return;
      console.error('Chart load error:', error);
      resetChart();
      setNoData(true);
      setLoading(false);
    }
  }, [symbol, height, chartType, syncAlertPriceLines, updateTradeOverlays, resetChart]);

  useEffect(() => {
    const controller = new AbortController();
    loadChart(activeRange, controller.signal);
    return () => controller.abort();
  }, [activeRange, loadChart]);

  useEffect(() => {
    return () => {
      resetChart();
    };
  }, [resetChart]);

  // Update markers without recreating the entire chart
  useEffect(() => {
    if (seriesRef.current && dataTimesRef.current.size > 0) {
      try {
        const validMarkers = getNonTradeMarkers(markers, dataTimesRef.current);
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

  const handleMouseDown = () => {
    if (!tooltip.show || comparingRef.current) return;
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
          <TimeRangeFilter value={activeRange} onChange={setInternalRange} />
        </div>
      )}
      <div style={{ position: 'relative', minHeight: height, height }}>
        {loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 10,
              padding: hasRenderedChart ? 0 : 16,
              background: hasRenderedChart ? 'rgba(15, 22, 41, 0.45)' : '#0f1629',
            }}
          >
            {!hasRenderedChart && (
              <Skeleton.Node active style={{ width: '100%', height: Math.max(height - 32, 120), borderRadius: 0 }} />
            )}
          </div>
        )}
        <div ref={containerRef} style={{ minHeight: height, height }} />
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
        {tradeOverlays.map((marker) => (
          <div
            key={marker.key}
            style={{
              position: 'absolute',
              top: marker.y,
              left: marker.x,
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: marker.color,
              border: '2px solid #111827',
              boxShadow: `0 0 0 3px ${marker.color}33, 0 0 14px ${marker.color}99`,
              transform: 'translate(-50%, -50%)',
              zIndex: 4,
              pointerEvents: 'none',
            }}
          />
        ))}

        {comparison && (
          <div
            className="chart-comparison"
            style={{ width: comparison.width, height: comparison.height }}
          >
            <svg width={comparison.width} height={comparison.height} aria-hidden="true">
              <rect
                x={comparison.start.x} y={0}
                width={Math.max(1, comparison.end.x - comparison.start.x)} height={comparison.height}
                fill="#f5f5f5" fillOpacity={0.1}
              />
              {[comparison.start, comparison.end].map((point, index) => (
                <g key={index}>
                  <line x1={point.x} x2={point.x} y1={0} y2={comparison.height} stroke="#f5f5f5" strokeDasharray="4 3" />
                  <circle cx={point.x} cy={point.y} r={4} fill="#f5f5f5" stroke="#111827" strokeWidth={2} />
                </g>
              ))}
            </svg>
            <div className="chart-comparison-summary" role="status">
              <span className="chart-comparison-dates">
                {comparisonDate.format(comparison.start.time * 1000)} → {comparisonDate.format(comparison.end.time * 1000)}
              </span>
              <span>{comparisonPrice.format(comparison.start.price)} → {comparisonPrice.format(comparison.end.price)}</span>
              <strong className={comparison.change > 0 ? 'gain' : comparison.change < 0 ? 'loss' : 'neutral'}>
                {comparison.change > 0 ? '+' : ''}{comparisonPrice.format(comparison.change)}
                {comparison.percentChange !== null && (
                  <> ({comparison.percentChange > 0 ? '+' : ''}{comparison.percentChange.toFixed(2)}%)</>
                )}
              </strong>
            </div>
          </div>
        )}
        
        {/* Legend / Tooltip Overlay */}
        {tooltip.show && !comparison && (
          <div style={{
            position: 'absolute',
            top: 12,
            left: 12,
            zIndex: 5,
            pointerEvents: 'none',
            background: 'rgba(15, 22, 41, 0.8)',
            backdropFilter: 'blur(4px)',
            padding: '8px 12px',
            borderRadius: 0,
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
                color: '#f5f5f5',
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
