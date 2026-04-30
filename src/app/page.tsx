'use client';

import React, { useMemo, useState } from 'react';
import { Card, Statistic, Row, Col, Table, Tag, Spin, Empty, Button } from 'antd';
import {
  DollarOutlined,
  RiseOutlined,
  FallOutlined,
  FundOutlined,
  TrophyOutlined,
  FolderOutlined,
} from '@ant-design/icons';
import { useStore } from '@/context/StoreContext';
import { useStockQuotes } from '@/hooks/useStockQuote';
import PnLDisplay from '@/components/shared/PnLDisplay';
import StockDetailDrawer from '@/components/charts/StockDetailDrawer';
import { useRouter } from 'next/navigation';
import { calculateCampaignStats } from '@/lib/campaignStats';

interface CampaignTableRow {
  key: string;
  name: string;
  stocks: number;
  invested: number;
  currentValue: number;
  realizedGain: number;
  pnl: number;
  pnlPercent: number;
}

export default function DashboardPage() {
  const { state } = useStore();
  const router = useRouter();
  const [drawerSymbol, setDrawerSymbol] = useState<string | null>(null);

  // Collect all unique symbols across campaigns
  const allSymbols = useMemo(() => {
    const symbols = new Set<string>();
    state.campaigns.forEach((c) => c.stocks.forEach((s) => symbols.add(s.symbol)));
    return Array.from(symbols);
  }, [state.campaigns]);

  const { quotes, loading: quotesLoading } = useStockQuotes(allSymbols);

  // Calculate portfolio-wide stats
  const stats = useMemo(() => {
    const campaignStats = state.campaigns.map((campaign) => calculateCampaignStats(campaign, quotes));
    const totalInvested = campaignStats.reduce((sum, stat) => sum + stat.invested, 0);
    const totalCurrentValue = campaignStats.reduce((sum, stat) => sum + stat.currentValue, 0);
    const totalRealizedGain = campaignStats.reduce((sum, stat) => sum + stat.realized, 0);
    const totalPnL = campaignStats.reduce((sum, stat) => sum + stat.pnl, 0);
    const totalPnLBasis = totalInvested + Math.abs(totalRealizedGain);
    const totalPnLPercent = totalInvested > 0 ? (totalPnL / totalPnLBasis) * 100 : 0;

    return {
      totalInvested,
      totalCurrentValue,
      totalRealizedGain,
      unrealizedGain: totalCurrentValue - totalInvested,
      totalPnL,
      totalPnLPercent,
    };
  }, [state.campaigns, quotes]);

  // Campaign table data
  const campaignData = useMemo<CampaignTableRow[]>(() => {
    return state.campaigns.map((campaign) => {
      const campaignStats = calculateCampaignStats(campaign, quotes);

      return {
        key: campaign._id ?? campaign.name,
        name: campaign.name,
        stocks: campaign.stocks.length,
        invested: campaignStats.invested,
        currentValue: campaignStats.currentValue,
        realizedGain: campaignStats.realized,
        pnl: campaignStats.pnl,
        pnlPercent: campaignStats.pnlPercent,
      };
    });
  }, [state.campaigns, quotes]);

  if (state.loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Dashboard</h1>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          {quotesLoading ? 'Updating prices...' : 'Prices up to date'}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="stats-grid animate-in">
        <Card className="stat-card" bordered={false}>
          <Statistic
            title={<span style={{ color: '#64748b' }}>Total Invested</span>}
            value={stats.totalInvested}
            prefix={<DollarOutlined style={{ color: '#3b82f6' }} />}
            precision={2}
            valueStyle={{ color: '#e2e8f0' }}
            formatter={(value) => `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          />
        </Card>
        <Card className="stat-card" bordered={false}>
          <Statistic
            title={<span style={{ color: '#64748b' }}>Current Value</span>}
            value={stats.totalCurrentValue}
            prefix={<FundOutlined style={{ color: '#00d4aa' }} />}
            precision={2}
            valueStyle={{ color: '#e2e8f0' }}
            formatter={(value) => `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          />
        </Card>
        <Card className="stat-card" bordered={false}>
          <Statistic
            title={<span style={{ color: '#64748b' }}>Total P&L</span>}
            value={stats.totalPnL}
            prefix={stats.totalPnL >= 0 ? <RiseOutlined style={{ color: '#22c55e' }} /> : <FallOutlined style={{ color: '#ef4444' }} />}
            precision={2}
            valueStyle={{ color: stats.totalPnL >= 0 ? '#22c55e' : '#ef4444' }}
            formatter={(value) => `${Number(value) >= 0 ? '+' : ''}$${Math.abs(Number(value)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
            suffix={<span style={{ fontSize: 14 }}>({stats.totalPnLPercent >= 0 ? '+' : ''}{stats.totalPnLPercent.toFixed(1)}%)</span>}
          />
        </Card>
        <Card className="stat-card" bordered={false}>
          <Statistic
            title={<span style={{ color: '#64748b' }}>Realized Gains</span>}
            value={stats.totalRealizedGain}
            prefix={<TrophyOutlined style={{ color: '#f59e0b' }} />}
            precision={2}
            valueStyle={{ color: stats.totalRealizedGain >= 0 ? '#22c55e' : '#ef4444' }}
            formatter={(value) => `${Number(value) >= 0 ? '+' : ''}$${Math.abs(Number(value)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          />
        </Card>
      </div>

      {/* Active Alerts Summary */}
      {state.alerts.filter((a) => !a.triggered).length > 0 && (
        <Card
          title={<span style={{ color: '#e2e8f0' }}>🔔 Active Alerts</span>}
          bordered={false}
          style={{ marginBottom: 24 }}
          extra={
            <Button type="link" onClick={() => router.push('/alerts')}>
              View All
            </Button>
          }
        >
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {state.alerts
              .filter((a) => !a.triggered)
              .slice(0, 6)
              .map((alert) => (
                <Tag
                  key={alert._id}
                  color={alert.type === 'above' ? 'green' : 'red'}
                  style={{ padding: '4px 12px', fontSize: 13 }}
                >
                  {alert.symbol} {alert.type === 'above' ? '↑' : '↓'}{' '}
                  {alert.targetPrice != null ? `$${alert.targetPrice}` : `${alert.targetPercent}%`}
                </Tag>
              ))}
          </div>
        </Card>
      )}

      {/* Campaign Table */}
      <Card
        title={
          <span style={{ color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <FolderOutlined /> Campaigns Overview
          </span>
        }
        bordered={false}
        extra={
          <Button type="primary" onClick={() => router.push('/campaigns')}>
            Manage Campaigns
          </Button>
        }
      >
        {campaignData.length === 0 ? (
          <Empty
            description={<span style={{ color: '#64748b' }}>No campaigns yet. Create your first campaign!</span>}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <Table<CampaignTableRow>
            dataSource={campaignData}
            pagination={false}
            onRow={(record) => ({
              onClick: () => router.push(`/campaigns/${record.key}`),
              style: { cursor: 'pointer' },
            })}
            columns={[
              {
                title: 'Campaign',
                dataIndex: 'name',
                key: 'name',
                render: (name: string) => <span style={{ fontWeight: 600 }}>{name}</span>,
              },
              {
                title: 'Stocks',
                dataIndex: 'stocks',
                key: 'stocks',
                render: (count: number) => <Tag color="blue">{count}</Tag>,
                width: 80,
              },
              {
                title: 'Invested',
                dataIndex: 'invested',
                key: 'invested',
                render: (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                align: 'right' as const,
              },
              {
                title: 'Current Value',
                dataIndex: 'currentValue',
                key: 'currentValue',
                render: (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
                align: 'right' as const,
              },
              {
                title: 'P&L',
                key: 'pnl',
                render: (_: unknown, record: { pnl: number; pnlPercent: number }) => (
                  <PnLDisplay value={record.pnl} percentage={record.pnlPercent} />
                ),
                align: 'right' as const,
              },
            ]}
          />
        )}
      </Card>

      <StockDetailDrawer
        symbol={drawerSymbol}
        open={!!drawerSymbol}
        onClose={() => setDrawerSymbol(null)}
      />
    </div>
  );
}
