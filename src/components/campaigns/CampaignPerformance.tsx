"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Segmented, Skeleton } from "antd";
import { Campaign, StockQuote } from "@/types";
import { ChangeCapsule } from "@/components/campaigns/CampaignSummary";
import PerformanceChart, { type PerformanceRange } from "@/components/charts/PerformanceChart";
import { type TimeRange } from "@/components/charts/timeRanges";
import { useCampaignHistory } from "@/hooks/useCampaignHistory";
import {
  buildPerformanceSeries,
  getPerformanceWindow,
  metricAt,
  periodReturnPercent,
  summarizePerformance,
  unrealizedPercent,
  type PerformanceMode,
  type PerformancePoint,
} from "@/lib/campaignPerformance";
import { formatSignedUsd, formatUsd } from "@/lib/campaignFormat";

type CampaignPerformanceProps = {
  campaign: Campaign;
  quotes: Record<string, StockQuote>;
  /** The range chosen in the bar above; it scopes this chart and the stock charts alike. */
  range: TimeRange;
};

const CHART_HEIGHT = 240;

const RANGE_LABELS: Record<TimeRange, string> = {
  "1W": "Past Week",
  "1M": "Past Month",
  "3M": "Past 3 Months",
  "6M": "Past 6 Months",
  "1Y": "Past Year",
  ALL: "All Time",
};

/* Day keys are UTC; formatting them in the local zone would shift the label a
   day for anyone west of Greenwich. */
const dayDate = (day: string) => new Date(`${day}T00:00:00Z`);

const shortDay = (day: string) => dayDate(day).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const readoutDay = (day: string) => {
  const date = dayDate(day);
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
};

/* Spelled out for VoiceOver: "June 6, 2026" beats "6/6/26". */
const spokenDay = (day: string) =>
  dayDate(day).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/* Axis labels: "$12K", "-$1.4K", "+$320". */
const buildAxisFormatter = (mode: PerformanceMode) => {
  const format = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
    signDisplay: mode === "pnl" ? "exceptZero" : "auto",
  });

  return (value: number) => format.format(value);
};

function PerformanceSkeleton() {
  return (
    <>
      <div className="performance-skeleton">
        <Skeleton.Input active size="small" style={{ width: 104, minWidth: 104 }} />
        <Skeleton.Input active size="large" style={{ width: 180 }} />
        <Skeleton.Input active size="small" style={{ width: 150 }} />
      </div>
      <Skeleton.Node active style={{ width: "100%", height: CHART_HEIGHT, borderRadius: 0 }} />
    </>
  );
}

/**
 * The campaign's money over time: P&L since the start of the chosen range, or
 * what is in stocks against what it cost.
 *
 * The readout above the chart is also its legend and its text alternative —
 * every figure the chart draws is readable as text, hover or not.
 */
export default function CampaignPerformance({ campaign, quotes, range }: CampaignPerformanceProps) {
  const [mode, setMode] = useState<PerformanceMode>("pnl");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  /** A span being measured on the chart; only set while the gesture is held. */
  const [measured, setMeasured] = useState<PerformanceRange | null>(null);

  const chartWindow = useMemo(() => getPerformanceWindow(campaign, range), [campaign, range]);
  const { history, loading } = useCampaignHistory(chartWindow);

  // Built against the window the data came from, so a range change never paints
  // the old prices over the new dates.
  const series = useMemo(
    () => (history ? buildPerformanceSeries(campaign, history.closes, quotes, history.window) : null),
    [campaign, history, quotes],
  );

  const summary = useMemo(() => (series ? summarizePerformance(series, mode) : null), [series, mode]);

  const plot = useMemo(
    () => series?.points.map((point) => ({ time: point.time, value: metricAt(point, mode, series.baseline) })) ?? [],
    [series, mode],
  );

  const investedPlot = useMemo(
    () => (mode === "value" ? series?.points.map((point) => ({ time: point.time, value: point.invested })) : undefined),
    [series, mode],
  );

  const formatAxisValue = useMemo(() => buildAxisFormatter(mode), [mode]);

  const points = series?.points ?? [];
  const baseline = series?.baseline;
  // A range or metric change can outlive the hovered index.
  const hoverIndex = activeIndex != null && activeIndex < points.length ? activeIndex : null;
  const active = points[hoverIndex ?? points.length - 1];

  // Named after the window on screen, not the one just clicked: during a reload
  // the chart still shows the previous range, and the label should agree with it.
  const shownWindow = history?.window ?? chartWindow;
  const periodLabel =
    !shownWindow ? ""
    : shownWindow.range === "ALL" ? RANGE_LABELS.ALL
    : shownWindow.clipped ? `Since ${readoutDay(shownWindow.fromDay)}`
    : RANGE_LABELS[shownWindow.range];

  const chartLabel = `${mode === "pnl" ? "Profit and loss" : "Money in stocks"}, ${periodLabel.toLowerCase()}`;

  const describeIndex = useCallback(
    (index: number) => {
      const point = points[index];
      if (!point || !baseline) return "";

      if (mode === "value") {
        return `${spokenDay(point.day)}: ${formatUsd(point.value)} in stocks, ${formatUsd(point.invested)} invested`;
      }

      const gain = point.pnl - baseline.pnl;
      const direction = gain > 0 ? "up" : gain < 0 ? "down" : "even";
      return `${spokenDay(point.day)}: ${direction} ${formatUsd(Math.abs(gain))} for the period`;
    },
    [points, baseline, mode],
  );

  const describeRange = useCallback(
    (span: PerformanceRange) => {
      const from = points[span.from];
      const to = points[span.to];
      if (!from || !to) return "";

      const change = mode === "pnl" ? to.pnl - from.pnl : to.value - from.value;
      const direction = change > 0 ? "up" : change < 0 ? "down" : "even";
      return `${spokenDay(from.day)} to ${spokenDay(to.day)}: ${direction} ${formatUsd(Math.abs(change))}${mode === "value" ? " in stocks" : ""}`;
    },
    [points, mode],
  );

  const changeMode = (next: PerformanceMode) => {
    setMode(next);
    setActiveIndex(null);
    setMeasured(null);
  };

  if (!chartWindow) return null;

  const requested = history?.window.requests.length ?? 0;
  const missing = history?.missing ?? [];
  const allMissing = requested > 0 && missing.length === requested;
  const ready = series != null && baseline != null && active != null && plot.length > 1;

  const renderBody = () => {
    if (!history || (loading && !ready)) return <PerformanceSkeleton />;

    if (allMissing || !ready) {
      return (
        <p className="performance-notice">
          Price history isn’t available right now, so there’s nothing to chart yet. The figures above still show where this campaign
          stands.
        </p>
      );
    }

    // Everything was sold before this range opened: a flat line at zero and four
    // zeroed stats say less than one sentence does.
    if (series.points.every((point) => point.invested === 0)) {
      return (
        <p className="performance-notice">
          No positions were open in this period, so nothing moved. The campaign’s realized P&amp;L of {formatSignedUsd(active.pnl)} still
          stands — pick a longer range to see how it got there.
        </p>
      );
    }

    const stepNoun = history.window.resolution === "W" ? "Week" : "Day";
    const metrics =
      summary ?
        [
          { label: "High", extreme: summary.high, signed: mode === "pnl" },
          { label: "Low", extreme: summary.low, signed: mode === "pnl" },
          { label: `Best ${stepNoun}`, extreme: summary.best, signed: true },
          { label: `Worst ${stepNoun}`, extreme: summary.worst, signed: true },
        ]
      : [];

    // While a span is measured the readout is the difference between its two ends,
    // the way a stock chart's two-finger comparison works. The capsule stays a
    // gain measure either way: the span's P&L against the money in play, so new
    // buys raise the value line without reading as a gain.
    const measuredFrom = measured ? points[measured.from] : undefined;
    const measuredTo = measured ? points[measured.to] : undefined;

    const readout =
      measuredFrom && measuredTo ?
        {
          label: `${readoutDay(measuredFrom.day)} – ${readoutDay(measuredTo.day)}`,
          value: formatSignedUsd(mode === "pnl" ? measuredTo.pnl - measuredFrom.pnl : measuredTo.value - measuredFrom.value),
          percentage: periodReturnPercent(measuredTo, measuredFrom),
          detail:
            mode === "value" ?
              `Invested ${formatSignedUsd(measuredTo.invested - measuredFrom.invested)}`
            : `Total P&L ${formatSignedUsd(measuredFrom.pnl)} → ${formatSignedUsd(measuredTo.pnl)}`,
        }
      : {
          label: hoverIndex != null ? readoutDay(active.day) : periodLabel,
          value: mode === "pnl" ? formatSignedUsd(active.pnl - baseline.pnl) : formatUsd(active.value),
          percentage: mode === "pnl" ? periodReturnPercent(active, baseline) : unrealizedPercent(active),
          detail: mode === "value" ? `Invested ${formatUsd(active.invested)}` : `Total P&L ${formatSignedUsd(active.pnl)}`,
        };

    return (
      <>
        <dl className="performance-readout">
          <dt>{readout.label}</dt>
          <dd>
            <span className="performance-readout-value">{readout.value}</span>
            <span className="performance-readout-meta">
              <ChangeCapsule percentage={readout.percentage} />
              <span className="performance-readout-detail">
                {/* Doubles as the chart's legend: this is the dashed line. */}
                {mode === "value" && <span className="performance-key" aria-hidden />}
                {readout.detail}
              </span>
            </span>
          </dd>
        </dl>

        <PerformanceChart
          data={plot}
          reference={investedPlot}
          tone={mode === "pnl" ? "polarity" : "neutral"}
          height={CHART_HEIGHT}
          formatValue={formatAxisValue}
          describeIndex={describeIndex}
          label={chartLabel}
          activeIndex={hoverIndex}
          onActiveIndexChange={setActiveIndex}
          range={measured}
          onRangeChange={setMeasured}
          describeRange={describeRange}
          busy={loading}
        />

        {metrics.length > 0 && (
          <dl className="performance-metrics">
            {metrics.map((metric) => (
              <div key={metric.label}>
                <dt>{metric.label}</dt>
                <dd>
                  <strong>{metric.signed ? formatSignedUsd(metric.extreme.value) : formatUsd(metric.extreme.value)}</strong>
                  <small>{shortDay(metric.extreme.day)}</small>
                </dd>
              </div>
            ))}
          </dl>
        )}

        {missing.length > 0 && !allMissing && (
          <p className="performance-notice performance-notice-footnote">
            No price history for {missing.join(", ")} —{" "}
            {missing.length === 1 ? "that position sits at its buy price here" : "those positions sit at their buy price here"}.
          </p>
        )}
      </>
    );
  };

  return (
    <section className="campaigns-section" aria-labelledby="performance-title">
      <div className="campaigns-section-header">
        <h2 id="performance-title" className="campaigns-section-title">
          Performance
        </h2>
        <Segmented
          options={[
            { value: "pnl", label: "P&L" },
            { value: "value", label: "Value" },
          ]}
          value={mode}
          onChange={(next) => changeMode(next as PerformanceMode)}
        />
      </div>

      <div className="performance-panel">{renderBody()}</div>
    </section>
  );
}
