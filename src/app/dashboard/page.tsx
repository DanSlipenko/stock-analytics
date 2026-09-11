'use client';

import React, { useMemo, useState } from 'react';
import { Spin, Empty, Button } from 'antd';
import Link from 'next/link';
import { ArrowDownOutlined, ArrowUpOutlined, RightOutlined } from '@ant-design/icons';
import { useStore } from '@/context/StoreContext';
import { useStockQuotes } from '@/hooks/useStockQuote';
import { usePeriodPrices } from '@/hooks/usePeriodPrices';
import CampaignSummary, { SummaryMetric } from '@/components/campaigns/CampaignSummary';
import MetaLine from '@/components/shared/MetaLine';
import PnLDisplay from '@/components/shared/PnLDisplay';
import StockDetailDrawer from '@/components/charts/StockDetailDrawer';
import { useRouter } from 'next/navigation';
import { calculateCampaignStats } from '@/lib/campaignStats';
import { formatUsd, pluralize } from '@/lib/campaignFormat';
import { formatAlertDirection, formatAlertTarget } from '@/lib/alertFormat';
import { annualForStocks, getCostPerShare, getSoldShares, lastDayForStocks } from '@/lib/assets';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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

  const allStocks = useMemo(() => state.campaigns.flatMap((campaign) => campaign.stocks), [state.campaigns]);

  // Collect all unique symbols across campaigns
  const allSymbols = useMemo(() => Array.from(new Set(allStocks.map((stock) => stock.symbol))), [allStocks]);

  const { quotes, loading: quotesLoading } = useStockQuotes(allSymbols);
  const { yearStartPrices, loading: periodPricesLoading } = usePeriodPrices(allSymbols);
  const quotesPending = allSymbols.length > 0 && quotesLoading && Object.keys(quotes).length === 0;
  const periodPricesPending = allSymbols.length > 0 && periodPricesLoading && Object.keys(yearStartPrices).length === 0;

  // Calculate portfolio-wide stats
  const stats = useMemo(() => {
    const campaignStats = state.campaigns.map((campaign) => calculateCampaignStats(campaign, quotes));
    const totalInvested = campaignStats.reduce((sum, stat) => sum + stat.invested, 0);
    const totalCurrentValue = campaignStats.reduce((sum, stat) => sum + stat.currentValue, 0);
    const totalRealizedGain = campaignStats.reduce((sum, stat) => sum + stat.realized, 0);
    const totalPnL = campaignStats.reduce((sum, stat) => sum + stat.pnl, 0);
    // Cost of every share bought, so a sale doesn't shrink the denominator.
    const totalCostBasis = campaignStats.reduce((sum, stat) => sum + stat.costBasis, 0);
    const totalPnLPercent = totalCostBasis > 0 ? (totalPnL / totalCostBasis) * 100 : 0;
    const realizedBasis = allStocks.reduce((sum, stock) => sum + getSoldShares(stock) * getCostPerShare(stock), 0);

    return {
      totalInvested,
      totalCurrentValue,
      totalRealizedGain,
      totalRealizedPercent: realizedBasis > 0 ? (totalRealizedGain / realizedBasis) * 100 : 0,
      totalPnL,
      totalPnLPercent,
    };
  }, [state.campaigns, allStocks, quotes]);

  const today = useMemo(() => lastDayForStocks(allStocks, quotes), [allStocks, quotes]);
  const annual = useMemo(() => annualForStocks(allStocks, quotes, yearStartPrices), [allStocks, quotes, yearStartPrices]);

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

  const activeAlerts = state.alerts.filter((alert) => !alert.triggered);

  if (state.loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  // Ordered by time horizon, shortest first; realized gains close the row.
  const summaryMetrics: SummaryMetric[] = [
    { label: 'Today', value: today.value, percentage: today.percentage, pending: quotesPending },
    {
      label: 'This Year',
      value: annual.pnl,
      percentage: annual.pnlPercent,
      pending: quotesPending || periodPricesPending,
    },
    { label: 'Total P&L', value: stats.totalPnL, percentage: stats.totalPnLPercent, pending: quotesPending },
    { label: 'Realized', value: stats.totalRealizedGain, percentage: stats.totalRealizedPercent },
  ];

  return (
    <div className="page-container campaigns-page campaigns-container">
      <div className="page-header">
        <div className="campaign-page-heading">
          <h1>Dashboard</h1>
          <p className="campaign-page-subtitle">{quotesLoading ? 'Updating prices…' : 'Prices up to date'}</p>
        </div>
      </div>

      <CampaignSummary
        label="Total in Stocks"
        value={stats.totalCurrentValue}
        pending={quotesPending}
        detail={`Invested ${formatUsd(stats.totalInvested)}`}
        metrics={summaryMetrics}
      />

      {activeAlerts.length > 0 && (
        <section className="campaigns-section" aria-labelledby="dashboard-alerts-title">
          <div className="campaigns-section-header">
            <h2 id="dashboard-alerts-title" className="campaigns-section-title">
              Active Alerts <span className="campaigns-section-count">{activeAlerts.length}</span>
            </h2>
            <Button type="text" onClick={() => router.push('/alerts')}>
              View All
            </Button>
          </div>
          <div className="money-location-grid">
            {activeAlerts.slice(0, 6).map((alert) => (
              <div key={alert._id ?? `${alert.symbol}-${alert.createdAt}`} className="money-location-tile">
                <div className="money-location-tile-name">
                  <strong>{alert.symbol}</strong>
                  <span className="alert-condition">
                    {alert.type === 'above' ? <ArrowUpOutlined aria-hidden /> : <ArrowDownOutlined aria-hidden />}
                    {formatAlertDirection(alert.type)}
                  </span>
                </div>
                <div className="money-location-tile-count">
                  <strong>{formatAlertTarget(alert)}</strong>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="campaigns-section" aria-labelledby="dashboard-campaigns-title">
        <div className="campaigns-section-header">
          <h2 id="dashboard-campaigns-title" className="campaigns-section-title">
            Campaigns {campaignData.length > 0 && <span className="campaigns-section-count">{campaignData.length}</span>}
          </h2>
          <Button type="text" onClick={() => router.push('/campaigns')}>
            Manage
          </Button>
        </div>

        {campaignData.length === 0 ? (
          <div className="campaigns-panel campaigns-panel-padded">
            <Empty
              description={<span style={{ color: 'var(--text-secondary)' }}>No campaigns yet. Create your first campaign!</span>}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </div>
        ) : (
          <>
            <div className="campaigns-panel desktop-table">
              <Table aria-label="Campaigns overview" className="min-w-[640px] tabular-nums">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Campaign</TableHead>
                    <TableHead scope="col" className="text-right">Stocks</TableHead>
                    <TableHead scope="col" className="text-right">Invested</TableHead>
                    <TableHead scope="col" className="text-right">In Stocks</TableHead>
                    <TableHead scope="col" className="text-right">P&amp;L</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaignData.map(record => (
                    <TableRow
                      key={record.key}
                      className="cursor-pointer"
                      onClick={() => router.push(`/campaigns/${record.key}`)}
                    >
                      <TableCell className="min-w-44 max-w-72 whitespace-normal break-words">
                        <Link
                          href={`/campaigns/${record.key}`}
                          className="table-symbol table-link"
                          onClick={event => event.stopPropagation()}
                        >
                          {record.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right">{record.stocks}</TableCell>
                      <TableCell className="text-right">{formatUsd(record.invested)}</TableCell>
                      <TableCell className="text-right">{formatUsd(record.currentValue)}</TableCell>
                      <TableCell className="text-right">
                        <PnLDisplay value={record.pnl} percentage={record.pnlPercent} size="small" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="grouped-list mobile-list" aria-label="Campaigns overview">
              {campaignData.map((record) => (
                <li key={record.key}>
                  <Link href={`/campaigns/${record.key}`} className="grouped-list-row">
                    <div className="grouped-list-main">
                      <span className="grouped-list-title">{record.name}</span>
                      <MetaLine
                        parts={[pluralize(record.stocks, 'stock'), `Invested ${formatUsd(record.invested, 0)}`]}
                        className="grouped-list-subtitle"
                      />
                    </div>
                    <div className="grouped-list-trailing">
                      <span className="grouped-list-value">{formatUsd(record.currentValue, 0)}</span>
                      <PnLDisplay value={record.pnl} percentage={record.pnlPercent} size="small" />
                    </div>
                    <RightOutlined className="grouped-list-chevron" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <StockDetailDrawer
        symbol={drawerSymbol}
        open={!!drawerSymbol}
        onClose={() => setDrawerSymbol(null)}
      />
    </div>
  );
}
