'use client';

import React, { useEffect, useState } from 'react';
import { Drawer, Descriptions, Spin, Tag, Space, Statistic, Row, Col } from 'antd';
import { GlobalOutlined, BankOutlined } from '@ant-design/icons';
import StockChart from './StockChart';
import PnLDisplay from '../shared/PnLDisplay';
import { CompanyProfile, StockQuote } from '@/types';

interface StockDetailDrawerProps {
  symbol: string | null;
  open: boolean;
  onClose: () => void;
}

export default function StockDetailDrawer({ symbol, open, onClose }: StockDetailDrawerProps) {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [quote, setQuote] = useState<StockQuote | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol || !open) return;

    setLoading(true);

    Promise.all([
      fetch(`/api/stock/profile?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()),
      fetch(`/api/stock/quote?symbol=${encodeURIComponent(symbol)}`).then((r) => r.json()),
    ])
      .then(([profileData, quoteData]) => {
        setProfile(profileData);
        setQuote(quoteData);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [symbol, open]);

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0' }}>{symbol}</span>
          {profile && (
            <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 400 }}>{profile.name}</span>
          )}
        </div>
      }
      open={open}
      onClose={onClose}
      width={640}
      styles={{ body: { padding: 0, background: '#0a0e1a' }, header: { background: '#111827', borderBottom: '1px solid #1e2a3a' } }}
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          {/* Quote Stats */}
          {quote && (
            <div style={{ padding: '20px 24px', background: '#111827', borderBottom: '1px solid #1e2a3a' }}>
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic
                    title={<span style={{ color: '#64748b' }}>Price</span>}
                    value={quote.currentPrice}
                    precision={2}
                    prefix="$"
                    valueStyle={{ color: '#e2e8f0', fontSize: 24 }}
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title={<span style={{ color: '#64748b' }}>Change</span>}
                    value={quote.change}
                    precision={2}
                    prefix="$"
                    valueStyle={{ color: quote.change >= 0 ? '#22c55e' : '#ef4444', fontSize: 24 }}
                  />
                </Col>
                <Col span={8}>
                  <div style={{ marginTop: 4 }}>
                    <div style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>P&L</div>
                    <PnLDisplay value={quote.change} percentage={quote.percentChange} size="large" />
                  </div>
                </Col>
              </Row>
            </div>
          )}

          {/* Chart */}
          {symbol && (
            <div style={{ padding: '16px 24px' }}>
              <StockChart symbol={symbol} height={350} />
            </div>
          )}

          {/* Company Details */}
          {profile && (
            <div style={{ padding: '0 24px 24px' }}>
              <Descriptions
                column={2}
                size="small"
                labelStyle={{ color: '#64748b' }}
                contentStyle={{ color: '#e2e8f0' }}
                style={{ marginTop: 16 }}
              >
                <Descriptions.Item label="Exchange">
                  <Tag color="blue">{profile.exchange}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Industry">
                  <Tag color="cyan">{profile.finnhubIndustry}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="Country">
                  {profile.country}
                </Descriptions.Item>
                <Descriptions.Item label="Market Cap">
                  ${(profile.marketCapitalization / 1000).toFixed(1)}B
                </Descriptions.Item>
              </Descriptions>

              <Space style={{ marginTop: 12 }}>
                {profile.weburl && (
                  <a href={profile.weburl} target="_blank" rel="noopener noreferrer">
                    <Tag icon={<GlobalOutlined />} color="default" style={{ cursor: 'pointer' }}>
                      Website
                    </Tag>
                  </a>
                )}
                <Tag icon={<BankOutlined />} color="default">
                  {profile.ticker}
                </Tag>
              </Space>
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
