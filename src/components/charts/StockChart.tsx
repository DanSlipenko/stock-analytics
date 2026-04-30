'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Spin } from 'antd';
import { StockCandle } from '@/types';

interface StockChartProps {
  symbol: string;
  height?: number;
  hideToolbar?: boolean;
  activeRangeOverride?: TimeRange;
  chartType?: 'candlestick' | 'area';
  markers?: import('lightweight-charts').SeriesMarker<import('lightweight-charts').Time>[];
}

export type TimeRange = '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL';

export const TIME_RANGES: { key: TimeRange; label: string; seconds: number }[] = [
  { key: '1W', label: '1W', seconds: 7 * 86400 },
  { key: '1M', label: '1M', seconds: 30 * 86400 },
  { key: '3M', label: '3M', seconds: 90 * 86400 },
  { key: '6M', label: '6M', seconds: 180 * 86400 },
  { key: '1Y', label: '1Y', seconds: 365 * 86400 },
  { key: 'ALL', label: 'ALL', seconds: 5 * 365 * 86400 },
];

export default function StockChart({ symbol, height = 400, hideToolbar = false, activeRangeOverride, chartType = 'candlestick', markers }: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof import('lightweight-charts').createChart> | null>(null);
  const seriesRef = useRef<import('lightweight-charts').ISeriesApi<'Candlestick'> | import('lightweight-charts').ISeriesApi<'Area'> | null>(null);
  const markersPluginRef = useRef<any>(null);
  const dataTimesRef = useRef<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [internalRange, setInternalRange] = useState<TimeRange>('1Y');
  
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

  const loadChart = useCallback(async (range: TimeRange) => {
    if (!containerRef.current) return;

    setLoading(true);

    const now = Math.floor(Date.now() / 1000);
    const rangeConfig = TIME_RANGES.find((r) => r.key === range)!;
    const from = now - rangeConfig.seconds;

    try {
      const res = await fetch(
        `/api/stock/candles?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${now}`
      );

      if (!res.ok) throw new Error('Failed to fetch candles');
      const data = await res.json();

      // Dynamic import for SSR safety
      const { createChart, ColorType, CrosshairMode, CandlestickSeries, AreaSeries, HistogramSeries, createSeriesMarkers } = await import('lightweight-charts');

      // Dispose old chart
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }

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

      const candles: StockCandle[] = data.candles || [];

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

        // Apply markers immediately if they exist
        if (markers && markers.length > 0) {
          try {
            const validMarkers = markers.map(m => {
              if (validTimes.has(String(m.time))) return m;
              let closest = Array.from(validTimes)[0];
              let minDiff = Infinity;
              const mTime = new Date(String(m.time)).getTime();
              for (const vt of validTimes) {
                const diff = Math.abs(new Date(vt).getTime() - mTime);
                if (diff < minDiff) {
                  minDiff = diff;
                  closest = vt;
                }
              }
              return { ...m, time: closest as import('lightweight-charts').Time };
            }).sort((a, b) => String(a.time).localeCompare(String(b.time)));

            const markersPlugin = createSeriesMarkers(mainSeries as any, validMarkers);
            markersPluginRef.current = markersPlugin;
          } catch (e) {
            console.error('[StockChart] Markers set error:', e);
          }
        }

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

        chart.timeScale().fitContent();
      }

      // Handle resize
      const handleResize = () => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
        }
      };

      window.addEventListener('resize', handleResize);

      setLoading(false);

      return () => {
        window.removeEventListener('resize', handleResize);
      };
    } catch (error) {
      console.error('Chart load error:', error);
      setLoading(false);
    }
  }, [symbol, height, chartType]);

  useEffect(() => {
    loadChart(activeRange);

    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
        markersPluginRef.current = null;
      }
    };
  }, [activeRange, loadChart]);

  // Update markers without recreating the entire chart
  useEffect(() => {
    if (seriesRef.current && markers && dataTimesRef.current.size > 0) {
      try {
        const validTimes = dataTimesRef.current;
        const validMarkers = markers.map(m => {
          if (validTimes.has(String(m.time))) return m;
          let closest = Array.from(validTimes)[0];
          let minDiff = Infinity;
          const mTime = new Date(String(m.time)).getTime();
          for (const vt of validTimes) {
            const diff = Math.abs(new Date(vt).getTime() - mTime);
            if (diff < minDiff) {
              minDiff = diff;
              closest = vt;
            }
          }
          return { ...m, time: closest as import('lightweight-charts').Time };
        }).sort((a, b) => String(a.time).localeCompare(String(b.time)));

        if (markersPluginRef.current) {
          markersPluginRef.current.setMarkers(validMarkers);
        } else {
          // Fallback if plugin wasn't created yet
          import('lightweight-charts').then(({ createSeriesMarkers }) => {
            if (seriesRef.current) {
              markersPluginRef.current = createSeriesMarkers(seriesRef.current, validMarkers);
            }
          });
        }
      } catch (e) {
        console.error('[StockChart] Markers effect error:', e);
      }
    }
  }, [markers]);

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
        <div ref={containerRef} />
        
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
