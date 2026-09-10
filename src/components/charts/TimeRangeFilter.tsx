"use client";

import { useId } from "react";
import { theme } from "antd";
import { motion, useReducedMotion } from "motion/react";
import { TIME_RANGES, type TimeRange } from "./timeRanges";

interface TimeRangeFilterProps {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
}

export default function TimeRangeFilter({ value, onChange }: TimeRangeFilterProps) {
  const id = useId();
  const { token } = theme.useToken();
  const reduceMotion = useReducedMotion();

  return (
    <motion.div layoutRoot className="time-range-group border border-neutral-100/20" role="group" aria-label="Chart time range">
      {TIME_RANGES.map((range) => (
        <button
          key={range.key}
          type="button"
          className={`time-range-btn ${value === range.key ? "active" : ""}`}
          aria-pressed={value === range.key}
          onClick={() => onChange(range.key)}>
          {value === range.key && (
            <motion.span
              className="time-range-highlight"
              layoutId={`time-range-highlight-${id}`}
              initial={false}
              aria-hidden="true"
              style={{ borderRadius: 6 }}
              transition={{
                type: "tween",
                duration: reduceMotion ? 0 : parseFloat(token.motionDurationSlow),
                // Match Ant Design's segmented thumb easing.
                ease: [0.645, 0.045, 0.355, 1],
              }}
            />
          )}
          {range.label}
        </button>
      ))}
    </motion.div>
  );
}
