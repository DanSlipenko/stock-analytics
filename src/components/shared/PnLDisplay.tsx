'use client';

import React from 'react';
import { ArrowUpOutlined, ArrowDownOutlined, MinusOutlined } from '@ant-design/icons';

interface PnLDisplayProps {
  value: number;
  percentage?: number;
  showArrow?: boolean;
  size?: 'small' | 'default' | 'large';
  prefix?: string;
}

export default function PnLDisplay({ value, percentage, showArrow = true, size = 'default', prefix = '$' }: PnLDisplayProps) {
  const isGain = value > 0;
  const isLoss = value < 0;
  const color = isGain ? '#22c55e' : isLoss ? '#ef4444' : '#94a3b8';

  const fontSize = size === 'small' ? 13 : size === 'large' ? 20 : 15;
  const iconSize = size === 'small' ? 10 : size === 'large' ? 16 : 12;

  return (
    <span style={{ color, fontSize, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {showArrow && (
        isGain ? <ArrowUpOutlined style={{ fontSize: iconSize }} /> :
        isLoss ? <ArrowDownOutlined style={{ fontSize: iconSize }} /> :
        <MinusOutlined style={{ fontSize: iconSize }} />
      )}
      <span>
        {isGain ? '+' : ''}{prefix}{Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      {percentage !== undefined && (
        <span style={{ fontSize: fontSize - 2, opacity: 0.85 }}>
          ({isGain ? '+' : ''}{percentage.toFixed(2)}%)
        </span>
      )}
    </span>
  );
}
