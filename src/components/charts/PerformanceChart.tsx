"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { IChartApi, ISeriesApi, MouseEventParams, SeriesType, Time, UTCTimestamp } from "lightweight-charts";
import { attachChartComparison } from "./chartComparison";

export type PerformancePlot = { time: number; value: number }[];

/** Two points being compared, as indexes into the plot, oldest first. */
export type PerformanceRange = { from: number; to: number };

/** 'polarity' splits the fill at zero — green above, red below. 'neutral' is one quiet line. */
export type PerformanceTone = "polarity" | "neutral";

interface PerformanceChartProps {
  data: PerformancePlot;
  /** A second, dashed step line: what the held shares cost. */
  reference?: PerformancePlot;
  tone: PerformanceTone;
  height?: number;
  /** Formats the price axis. */
  formatValue: (value: number) => string;
  /** Spoken description of one point, for the scrubber's accessible value. */
  describeIndex: (index: number) => string;
  label: string;
  activeIndex: number | null;
  onActiveIndexChange: (index: number | null) => void;
  /** The span being measured: held with two fingers, dragged across with a mouse, or
   * stretched with Shift and the arrow keys. Cleared when the gesture ends. */
  range: PerformanceRange | null;
  onRangeChange: (range: PerformanceRange | null) => void;
  /** Spoken description of a measured span, for the scrubber's accessible value. */
  describeRange: (range: PerformanceRange) => string;
  /** A refetch is in flight; the last render stays up, dimmed. */
  busy?: boolean;
}

type ComparisonOverlay = {
  start: { x: number; y: number };
  end: { x: number; y: number };
  width: number;
  height: number;
};

/** Oldest first, and nothing to measure when both ends land on the same point. */
const toRange = (a: number, b: number): PerformanceRange | null => (a === b ? null : { from: Math.min(a, b), to: Math.max(a, b) });

const SURFACE = "#111827";
const GRID = "rgba(226, 232, 240, 0.06)";
const CROSSHAIR = "rgba(226, 232, 240, 0.4)";
const AXIS_TEXT = "#94a3b8";
const ZERO_LINE = "rgba(226, 232, 240, 0.22)";
const GAIN = "#22c55e";
const LOSS = "#ef4444";
const VALUE_LINE = "#e2e8f0";
const INVESTED_LINE = "#64748b";
const COMPARE_FILL = "rgba(245, 245, 245, 0.08)";
const COMPARE_LINE = "rgba(245, 245, 245, 0.55)";
const COMPARE_POINT = "#f5f5f5";

export default function PerformanceChart({
  data,
  reference,
  tone,
  height = 240,
  formatValue,
  describeIndex,
  label,
  activeIndex,
  onActiveIndexChange,
  range,
  onRangeChange,
  describeRange,
  busy = false,
}: PerformanceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const referenceRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const toneRef = useRef<PerformanceTone | null>(null);
  /** Maps a point's timestamp back to its index, for crosshair lookups. */
  const indexByTimeRef = useRef(new Map<number, number>());
  const detachComparisonRef = useRef<(() => void) | null>(null);
  /** Two fingers are down: the crosshair stands aside until they lift. */
  const comparingRef = useRef(false);
  const hoverIndexRef = useRef<number | null>(null);
  /** Where a mouse drag, or a Shift+arrow measurement, started. */
  const dragAnchorRef = useRef<number | null>(null);
  const keyboardAnchorRef = useRef<number | null>(null);
  const [overlay, setOverlay] = useState<ComparisonOverlay | null>(null);

  // Read through refs so a new callback or formatter never rebuilds the chart.
  const formatValueRef = useRef(formatValue);
  formatValueRef.current = formatValue;
  const onActiveIndexChangeRef = useRef(onActiveIndexChange);
  onActiveIndexChangeRef.current = onActiveIndexChange;
  const onRangeChangeRef = useRef(onRangeChange);
  onRangeChangeRef.current = onRangeChange;

  const handleCrosshairMove = useCallback((param: MouseEventParams<Time>) => {
    if (comparingRef.current) return;

    const index = param.time == null || !param.point ? null : (indexByTimeRef.current.get(Number(param.time)) ?? null);
    hoverIndexRef.current = index;
    onActiveIndexChangeRef.current(index);

    // A mouse drag measures from where it was pressed to where the pointer is now.
    const anchor = dragAnchorRef.current;
    if (anchor != null && index != null) onRangeChangeRef.current(toRange(anchor, index));
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const lib = await import("lightweight-charts");
      const container = containerRef.current;
      if (cancelled || !container) return;

      const priceFormat = {
        type: "custom" as const,
        minMove: 0.01,
        formatter: (value: number) => formatValueRef.current(value),
      };

      let chart = chartRef.current;
      if (!chart) {
        chart = lib.createChart(container, {
          autoSize: true,
          height,
          layout: {
            background: { type: lib.ColorType.Solid, color: SURFACE },
            textColor: AXIS_TEXT,
            fontFamily: "'Inter', sans-serif",
            fontSize: 11,
            attributionLogo: false,
          },
          // Horizontal hairlines only: the dates are already labelled below.
          grid: { vertLines: { visible: false }, horzLines: { color: GRID } },
          crosshair: {
            mode: lib.CrosshairMode.Normal,
            vertLine: { color: CROSSHAIR, width: 1, style: lib.LineStyle.Solid, labelVisible: false },
            horzLine: { visible: false, labelVisible: false },
          },
          rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.14, bottom: 0.12 } },
          timeScale: { borderVisible: false, timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
          // This chart reads, it doesn't zoom: a wheel over it scrolls the page.
          handleScroll: false,
          handleScale: false,
          localization: { priceFormatter: (value: number) => formatValueRef.current(value) },
        });

        chart.subscribeCrosshairMove(handleCrosshairMove);
        chartRef.current = chart;
      }

      if (toneRef.current !== tone) {
        // Removing the series takes its price line with it.
        if (mainRef.current) chart.removeSeries(mainRef.current);

        if (tone === "polarity") {
          const series = chart.addSeries(lib.BaselineSeries, {
            baseValue: { type: "price", price: 0 },
            topLineColor: GAIN,
            topFillColor1: "rgba(34, 197, 94, 0.24)",
            topFillColor2: "rgba(34, 197, 94, 0.02)",
            bottomLineColor: LOSS,
            bottomFillColor1: "rgba(239, 68, 68, 0.02)",
            bottomFillColor2: "rgba(239, 68, 68, 0.24)",
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerRadius: 4,
            crosshairMarkerBorderColor: SURFACE,
            crosshairMarkerBorderWidth: 2,
            priceFormat,
          });

          // Break-even, so "above" and "below" read without relying on colour.
          series.createPriceLine({
            price: 0,
            color: ZERO_LINE,
            lineWidth: 1,
            lineStyle: lib.LineStyle.Solid,
            axisLabelVisible: false,
            title: "",
          });

          mainRef.current = series;
        } else {
          mainRef.current = chart.addSeries(lib.AreaSeries, {
            lineColor: VALUE_LINE,
            topColor: "rgba(226, 232, 240, 0.16)",
            bottomColor: "rgba(226, 232, 240, 0.01)",
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerRadius: 4,
            crosshairMarkerBorderColor: SURFACE,
            crosshairMarkerBorderWidth: 2,
            priceFormat,
          });
        }

        toneRef.current = tone;
      }

      if (reference && !referenceRef.current) {
        referenceRef.current = chart.addSeries(lib.LineSeries, {
          color: INVESTED_LINE,
          lineWidth: 2,
          // Dashed and stepped: a cost line holds flat until the next trade, and
          // the dashes tell it apart from the value line without colour.
          lineStyle: lib.LineStyle.Dashed,
          lineType: lib.LineType.WithSteps,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          priceFormat,
        });
      } else if (!reference && referenceRef.current) {
        chart.removeSeries(referenceRef.current);
        referenceRef.current = null;
      }

      const toSeriesData = (plot: PerformancePlot) => plot.map((point) => ({ time: point.time as UTCTimestamp, value: point.value }));

      mainRef.current?.setData(toSeriesData(data));
      referenceRef.current?.setData(toSeriesData(reference ?? []));
      indexByTimeRef.current = new Map(data.map((point, index) => [point.time, index]));
      chart.timeScale().fitContent();

      // Two fingers on a phone measure the span between them, as on a stock chart.
      // Re-armed with the data, because the gesture reads points and series as they are now.
      detachComparisonRef.current?.();
      detachComparisonRef.current =
        mainRef.current &&
        attachChartComparison(
          container,
          chart,
          mainRef.current,
          data,
          (point) => point.value,
          (comparison) => onRangeChangeRef.current(comparison && toRange(comparison.start.index, comparison.end.index)),
          (active) => {
            comparingRef.current = active;
            if (active) onActiveIndexChangeRef.current(null);
          },
        );
    })();

    return () => {
      cancelled = true;
    };
  }, [data, reference, tone, height, handleCrosshairMove]);

  useEffect(
    () => () => {
      detachComparisonRef.current?.();
      detachComparisonRef.current = null;
      chartRef.current?.remove();
      chartRef.current = null;
      mainRef.current = null;
      referenceRef.current = null;
      toneRef.current = null;
    },
    [],
  );

  // Place the measured span on the chart. A layout effect, so the band and the
  // readout above it change in the same frame.
  useLayoutEffect(() => {
    const chart = chartRef.current;
    const series = mainRef.current;
    if (!range || !chart || !series) {
      setOverlay(null);
      return;
    }

    const place = (index: number) => {
      const point = data[index];
      if (!point) return null;
      const x = chart.timeScale().timeToCoordinate(point.time as UTCTimestamp);
      const y = series.priceToCoordinate(point.value);
      return x === null || y === null ? null : { x, y };
    };

    const start = place(range.from);
    const end = place(range.to);
    const width = chart.timeScale().width();
    const paneHeight = chart.panes()[0]?.getHeight() ?? 0;
    setOverlay(start && end && width > 0 && paneHeight > 0 ? { start, end, width, height: paneHeight } : null);
  }, [range, data]);

  /** Moves the crosshair to one point, as hovering it would. */
  const scrubTo = useCallback(
    (index: number) => {
      const chart = chartRef.current;
      const series = mainRef.current;
      if (!chart || !series || data.length === 0) return;

      const clamped = Math.max(0, Math.min(data.length - 1, index));
      const point = data[clamped];
      chart.setCrosshairPosition(point.value, point.time as UTCTimestamp, series);
      onActiveIndexChange(clamped);
    },
    [data, onActiveIndexChange],
  );

  const clearScrub = useCallback(() => {
    chartRef.current?.clearCrosshairPosition();
    onActiveIndexChange(null);
  }, [onActiveIndexChange]);

  const endKeyboardMeasure = () => {
    if (keyboardAnchorRef.current == null) return;
    keyboardAnchorRef.current = null;
    onRangeChange(null);
  };

  const endDrag = () => {
    if (dragAnchorRef.current == null) return;
    dragAnchorRef.current = null;
    onRangeChange(null);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Mouse only: on touch screens two fingers do the measuring.
    if (event.pointerType !== "mouse" || event.button !== 0 || hoverIndexRef.current == null) return;
    dragAnchorRef.current = hoverIndexRef.current;
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (data.length === 0) return;

    const current = activeIndex ?? data.length - 1;

    // Shift with the arrows measures from where the scrub stood when it began.
    if (event.shiftKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      if (keyboardAnchorRef.current == null) keyboardAnchorRef.current = current;
      const next = Math.max(0, Math.min(data.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
      scrubTo(next);
      onRangeChange(toRange(keyboardAnchorRef.current, next));
      event.preventDefault();
      return;
    }

    switch (event.key) {
      case "ArrowLeft":
        scrubTo(current - 1);
        break;
      case "ArrowRight":
        scrubTo(current + 1);
        break;
      case "Home":
        scrubTo(0);
        break;
      case "End":
        scrubTo(data.length - 1);
        break;
      case "Escape":
        clearScrub();
        break;
      default:
        return;
    }

    // Moving without Shift, or Escape, lets go of a measurement.
    endKeyboardMeasure();
    event.preventDefault();
  };

  const describedIndex = activeIndex ?? data.length - 1;

  return (
    <div
      className="performance-chart"
      role="slider"
      tabIndex={0}
      aria-label={`${label}. Use the arrow keys to read the value on each date, and hold Shift to measure between two dates.`}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, data.length - 1)}
      aria-valuenow={Math.max(0, describedIndex)}
      aria-valuetext={
        range ? describeRange(range)
        : data.length > 0 ? describeIndex(describedIndex)
        : undefined
      }
      aria-busy={busy}
      onKeyDown={handleKeyDown}
      onBlur={() => {
        clearScrub();
        endKeyboardMeasure();
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}>
      <div ref={containerRef} style={{ height }} />

      {overlay && (
        <div className="chart-comparison" style={{ width: overlay.width, height: overlay.height }} aria-hidden>
          <svg width={overlay.width} height={overlay.height}>
            <rect
              x={overlay.start.x}
              y={0}
              width={Math.max(1, overlay.end.x - overlay.start.x)}
              height={overlay.height}
              fill={COMPARE_FILL}
            />
            {[overlay.start, overlay.end].map((point, index) => (
              <g key={index}>
                <line x1={point.x} x2={point.x} y1={0} y2={overlay.height} stroke={COMPARE_LINE} strokeDasharray="4 3" />
                <circle cx={point.x} cy={point.y} r={4} fill={COMPARE_POINT} stroke={SURFACE} strokeWidth={2} />
              </g>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}
