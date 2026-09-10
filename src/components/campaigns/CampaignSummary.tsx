"use client";

import React from "react";
import { Skeleton } from "antd";
import { ArrowUpOutlined, ArrowDownOutlined, MinusOutlined } from "@ant-design/icons";
import { formatSignedUsd, formatUsd } from "@/lib/campaignFormat";

export type SummaryMetric = {
  label: string;
  value: number;
  percentage: number;
  pending?: boolean;
};

type CampaignSummaryProps = {
  label: string;
  value: number;
  pending?: boolean;
  /** Secondary line under the headline value. */
  detail?: React.ReactNode;
  metrics: SummaryMetric[];
};

export function ChangeCapsule({ percentage }: { percentage: number }) {
  const tone =
    percentage > 0 ? "gain"
    : percentage < 0 ? "loss"
    : "flat";
  const Icon =
    tone === "gain" ? ArrowUpOutlined
    : tone === "loss" ? ArrowDownOutlined
    : MinusOutlined;

  return (
    <span className={`change-capsule change-capsule-${tone}`}>
      <Icon aria-hidden />
      {percentage > 0 ? "+" : ""}
      {percentage.toFixed(2)}%
    </span>
  );
}

/* One grouped panel: a headline balance, then P&L metrics with their % change in a tinted capsule. */
export default function CampaignSummary({ label, value, pending, detail, metrics }: CampaignSummaryProps) {
  return (
    <dl className="campaigns-summary animate-in">
      <div className="campaigns-summary-cell campaigns-summary-hero">
        <dt>{label}</dt>
        <dd>
          {pending ?
            <Skeleton.Input active size="large" style={{ width: 200 }} />
          : <span className="campaigns-summary-balance">{formatUsd(value)}</span>}
          {detail && <span className="campaigns-summary-detail">{detail}</span>}
        </dd>
      </div>
      {metrics.map((metric) => (
        <div key={metric.label} className="campaigns-summary-cell">
          <dt>{metric.label}</dt>
          <dd>
            {metric.pending ?
              <Skeleton.Input active size="small" style={{ width: 110 }} />
            : <>
                <span className="campaigns-summary-value">{formatSignedUsd(metric.value)}</span>
                <ChangeCapsule percentage={metric.percentage} />
              </>
            }
          </dd>
        </div>
      ))}
    </dl>
  );
}
