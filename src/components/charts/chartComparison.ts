import type { IChartApi, ISeriesApi, Logical, SeriesType } from 'lightweight-charts';

type ComparisonPoint = {
  x: number;
  y: number;
  time: number;
  price: number;
  /** Position in the points the comparison was attached with. */
  index: number;
};

export type ChartComparison = {
  start: ComparisonPoint;
  end: ComparisonPoint;
  change: number;
  percentChange: number | null;
  width: number;
  height: number;
};

// Capture two touches before the chart can interpret them as scrolling or zooming.
// Single-finger events and touchend still reach the chart to preserve its tracking lifecycle.
// `points` must be the series' data in order, one per bar; `valueOf` reads the plotted value.
export function attachChartComparison<T extends { time: number }>(
  container: HTMLDivElement,
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
  points: readonly T[],
  valueOf: (point: T) => number,
  onChange: (comparison: ChartComparison | null) => void,
  onActiveChange: (active: boolean) => void,
) {
  let comparing = false;

  const reset = () => {
    if (!comparing) return;
    comparing = false;
    onChange(null);
    chart.clearCrosshairPosition();
    onActiveChange(false);
  };

  const update = (event: TouchEvent) => {
    const touches = Array.from(event.touches).filter(touch => container.contains(touch.target as Node));
    const bounds = container.getBoundingClientRect();
    const width = chart.timeScale().width();
    const height = chart.panes()[0]?.getHeight() ?? 0;

    if (touches.length === 2 && event.touches.length === 2 && width > 0 && height > 0) {
      if (!comparing && touches.some(touch => (
        touch.clientX < bounds.left || touch.clientX >= bounds.left + width
        || touch.clientY < bounds.top || touch.clientY >= bounds.top + height
      ))) return;

      const picked = touches.map(touch => {
        const x = Math.max(0, Math.min(width - 1, touch.clientX - bounds.left));
        const logical = chart.timeScale().coordinateToLogical(x);
        if (logical === null) return null;
        const index = Math.max(0, Math.min(points.length - 1, Math.round(logical)));
        const point = points[index];
        const value = point ? valueOf(point) : NaN;
        if (!Number.isFinite(value)) return null;
        const y = series.priceToCoordinate(value);
        const snappedX = chart.timeScale().logicalToCoordinate(index as Logical);
        if (y === null || snappedX === null) return null;
        return { x: snappedX, y, time: point.time, price: value, index };
      });
      const [first, second] = picked;
      if (!first || !second) return;

      if (!comparing) {
        comparing = true;
        onActiveChange(true);
        chart.clearCrosshairPosition();
      }
      const [start, end] = first.time <= second.time ? [first, second] : [second, first];
      const change = end.price - start.price;
      onChange({
        start, end, change, width, height,
        percentChange: start.price !== 0 ? change / start.price * 100 : null,
      });
    } else if (comparing) {
      // Hide the comparison as soon as either finger lifts, but consume the
      // remaining finger's movement until release so the chart does not jump.
      onChange(null);
      if (touches.length === 0) reset();
    }

    if (comparing && event.cancelable) event.preventDefault();
    if (comparing && event.type === 'touchmove') event.stopPropagation();
  };

  const handleVisibilityChange = () => {
    if (document.hidden) reset();
  };
  const options = { capture: true, passive: false };
  container.addEventListener('touchstart', update, options);
  container.addEventListener('touchmove', update, options);
  container.addEventListener('touchend', update, options);
  container.addEventListener('touchcancel', reset, options);
  window.addEventListener('blur', reset);
  window.addEventListener('resize', reset);
  chart.timeScale().subscribeSizeChange(reset);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    container.removeEventListener('touchstart', update, options);
    container.removeEventListener('touchmove', update, options);
    container.removeEventListener('touchend', update, options);
    container.removeEventListener('touchcancel', reset, options);
    window.removeEventListener('blur', reset);
    window.removeEventListener('resize', reset);
    chart.timeScale().unsubscribeSizeChange(reset);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    reset();
  };
}
