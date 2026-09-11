"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Table, Empty, Space, Segmented, Skeleton, message } from "antd";
import {
  ArrowLeftOutlined,
  LeftOutlined,
  LineChartOutlined,
  UnorderedListOutlined,
  AppstoreOutlined,
  TagOutlined,
  TagsFilled,
} from "@ant-design/icons";
import { useRouter, useParams } from "next/navigation";
import { useStore } from "@/context/StoreContext";
import { useStockQuotes } from "@/hooks/useStockQuote";
import { usePeriodPrices } from "@/hooks/usePeriodPrices";
import StockChart, { ChartAlertRule, TimeRange } from "@/components/charts/StockChart";
import TimeRangeFilter from "@/components/charts/TimeRangeFilter";
import StockDetailDrawer from "@/components/charts/StockDetailDrawer";
import CampaignSummary, { SummaryMetric } from "@/components/campaigns/CampaignSummary";
import MetaLine from "@/components/shared/MetaLine";
import PnLDisplay from "@/components/shared/PnLDisplay";
import { formatStockSummary, pluralize } from "@/lib/campaignFormat";
import { cn } from "@/lib/utils";
import {
  annualForStocks,
  AssetStock,
  buildAssetGroups,
  formatCurrency,
  getAverageSoldPrice,
  getCostPerShare,
  getDisplayLastDayMovement,
  getRealizedPnL,
  getRealizedPnLPercent,
  getRemainingShares,
  getSoldShares,
  isSoldOut,
  lastDayForStocks,
  sortStarredFirst,
  statsForStocks,
} from "@/lib/assets";

const QuoteCellSkeleton = ({ width = 72 }: { width?: number }) => (
  <Skeleton.Input active size="small" style={{ width, minWidth: width }} />
);

const SKELETON_METRICS: SummaryMetric[] = ["Today", "This Year", "Total P&L", "Realized"].map((label) => ({
  label,
  value: 0,
  percentage: 0,
  pending: true,
}));

/* A position's place on the asset's sell list. Amber like a starred position: it marks intent, not a result. */
function SellToggle({ flagged, onToggle }: { flagged: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={cn("sell-toggle", flagged && "sell-toggle-on")}
      title={flagged ? "Remove from sell list" : "Add to sell list"}
      onClick={onToggle}>
      {flagged ?
        <TagsFilled aria-hidden />
      : <TagOutlined aria-hidden />}
      {flagged ? "Selling" : "Prepare"}
    </button>
  );
}

function BackToAssets() {
  const router = useRouter();

  return (
    <button type="button" className="campaigns-back-button" onClick={() => router.push("/assets")}>
      <LeftOutlined aria-hidden />
      Assets
    </button>
  );
}

function AssetDetailSkeleton() {
  return (
    <div className="page-container campaigns-page">
      <div className="page-header">
        <div className="campaign-page-heading">
          <BackToAssets />
          <Skeleton.Input active size="large" style={{ width: 220 }} />
          <Skeleton.Input active size="small" style={{ width: 200 }} />
        </div>
      </div>

      <div className="campaigns-container">
        <CampaignSummary label="Sellable Value" value={0} pending metrics={SKELETON_METRICS} />

        <section className="campaigns-section">
          <div className="campaigns-section-header">
            <h2 className="campaigns-section-title">Stocks</h2>
            <Skeleton.Button active size="small" style={{ width: 96 }} />
          </div>
          <div className="campaigns-panel campaigns-panel-padded">
            <Skeleton active paragraph={{ rows: 5 }} />
          </div>
        </section>
      </div>
    </div>
  );
}

export default function AssetDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { state, dispatch } = useStore();
  const slug = params.slug as string;

  const [viewMode, setViewMode] = useState<"list" | "candlestick" | "area">("list");
  const [globalTimeRange, setGlobalTimeRange] = useState<TimeRange>("3M");
  const [drawerSymbol, setDrawerSymbol] = useState<string | null>(null);

  const campaigns = state.campaigns;

  const group = useMemo(() => buildAssetGroups(campaigns).find((g) => g.slug === slug), [campaigns, slug]);

  const updateCampaignStocks = useCallback(
    async (campaignId: string, updatedStocks: unknown[]) => {
      try {
        const res = await fetch(`/api/campaigns/${campaignId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stocks: updatedStocks }),
        });
        if (res.ok) {
          const updated = await res.json();
          dispatch({ type: "UPDATE_CAMPAIGN", payload: updated });
          return true;
        }
        message.error("Could not update");
        return false;
      } catch (e) {
        console.error("Update prepare-to-sell error:", e);
        message.error("Could not update");
        return false;
      }
    },
    [dispatch],
  );

  const togglePrepareToSell = useCallback(
    async (stock: AssetStock) => {
      const campaign = state.campaigns.find((c) => c._id === stock.campaignId);
      if (!campaign) return;
      const updatedStocks = campaign.stocks.map((s) => (s._id === stock._id ? { ...s, prepareToSell: !s.prepareToSell } : s));
      await updateCampaignStocks(campaign._id!, updatedStocks);
    },
    [state.campaigns, updateCampaignStocks],
  );

  const clearPrepareToSell = useCallback(async () => {
    if (!group) return;
    const byCampaign = new Map<string, Set<string>>();
    group.stocks
      .filter((stock) => stock.prepareToSell)
      .forEach((stock) => {
        if (!stock._id) return;
        if (!byCampaign.has(stock.campaignId)) byCampaign.set(stock.campaignId, new Set());
        byCampaign.get(stock.campaignId)!.add(stock._id);
      });

    for (const [campaignId, ids] of byCampaign) {
      const campaign = state.campaigns.find((c) => c._id === campaignId);
      if (!campaign) continue;
      const updatedStocks = campaign.stocks.map((s) => (s._id && ids.has(s._id) ? { ...s, prepareToSell: false } : s));
      await updateCampaignStocks(campaignId, updatedStocks);
    }
  }, [group, state.campaigns, updateCampaignStocks]);

  const symbols = useMemo(() => {
    if (!group) return [];
    return Array.from(new Set(group.stocks.map((stock) => stock.symbol)));
  }, [group]);

  const { quotes, loading: quotesLoading } = useStockQuotes(symbols);
  const { yearStartPrices, loading: periodPricesLoading } = usePeriodPrices(symbols);
  const quotesPending = symbols.length > 0 && quotesLoading && Object.keys(quotes).length === 0;
  const periodPricesPending = symbols.length > 0 && periodPricesLoading && Object.keys(yearStartPrices).length === 0;

  if (state.loading) {
    return <AssetDetailSkeleton />;
  }

  if (!group) {
    return (
      <div className="page-container">
        <Empty description="Asset account not found" />
        <Button onClick={() => router.push("/assets")} icon={<ArrowLeftOutlined />} style={{ marginTop: 16 }}>
          Back to Assets
        </Button>
      </div>
    );
  }

  const stats = statsForStocks(group.stocks, quotes);
  const annual = annualForStocks(group.stocks, quotes, yearStartPrices);
  const lastDay = lastDayForStocks(group.stocks, quotes);
  const realizedBasis = group.stocks.reduce((sum, stock) => sum + getSoldShares(stock) * getCostPerShare(stock), 0);
  const campaignCount = new Set(group.stocks.map((stock) => stock.campaignId)).size;

  const sorted = sortStarredFirst(group.stocks);
  const activeStocks = sorted.filter((stock) => !isSoldOut(stock));
  const soldStocks = sorted.filter(isSoldOut);
  const toRows = (stocks: AssetStock[]) => stocks.map((stock) => ({ ...stock, key: `${stock.campaignId}-${stock._id}` }));

  const prepareStocks = activeStocks.filter((stock) => stock.prepareToSell);
  const prepareValue = prepareStocks.reduce((sum, stock) => {
    const currentPrice = quotes[stock.symbol]?.currentPrice ?? stock.buyPrice;
    return sum + getRemainingShares(stock) * currentPrice;
  }, 0);

  // Ordered by time horizon, shortest first; realized gains close the row.
  const summaryMetrics: SummaryMetric[] = [
    { label: "Today", value: lastDay.value, percentage: lastDay.percentage, pending: quotesPending },
    {
      label: "This Year",
      value: annual.pnl,
      percentage: annual.pnlPercent,
      pending: quotesPending || periodPricesPending,
    },
    { label: "Total P&L", value: stats.pnl, percentage: stats.pnlPercent, pending: quotesPending },
    { label: "Realized", value: stats.realized, percentage: realizedBasis > 0 ? (stats.realized / realizedBasis) * 100 : 0 },
  ];

  const buildMarkers = (stock: AssetStock) => {
    const markers: import("lightweight-charts").SeriesMarker<import("lightweight-charts").Time>[] = [];

    if (stock.buyDate) {
      const d = new Date(stock.buyDate);
      const timeStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
      markers.push({
        time: timeStr as unknown as import("lightweight-charts").Time,
        position: "belowBar",
        color: "#22c55e",
        shape: "arrowUp",
        text: `Buy @ $${stock.buyPrice}`,
      });
    }

    stock.transactions?.forEach((t) => {
      if (t.type === "sell" && t.date) {
        const d = new Date(t.date);
        const timeStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
        markers.push({
          time: timeStr as unknown as import("lightweight-charts").Time,
          position: "aboveBar",
          color: "#ef4444",
          shape: "arrowDown",
          text: `Sell @ $${t.price}`,
        });
      }
    });

    return markers;
  };

  const renderCampaignLink = (stock: AssetStock, className?: string) => (
    <Link href={`/campaigns/${stock.campaignId}`} className={className}>
      {stock.campaignName}
    </Link>
  );

  const stockColumns = [
    {
      title: "Symbol",
      dataIndex: "symbol",
      key: "symbol",
      render: (symbol: string, record: AssetStock) => {
        const soldOut = isSoldOut(record);
        return (
          <Space size={6}>
            <Button
              type="link"
              className={cn("stock-symbol-link", soldOut && "stock-symbol-link-sold")}
              onClick={() => setDrawerSymbol(symbol)}>
              {symbol} <LineChartOutlined style={{ fontSize: 11 }} />
            </Button>
            {soldOut && <span className="campaign-status">Sold</span>}
          </Space>
        );
      },
    },
    {
      title: "Shares",
      key: "shares",
      render: (_: unknown, record: AssetStock) => {
        const sold = getSoldShares(record);
        const remaining = getRemainingShares(record);
        return (
          <span>
            {remaining.toLocaleString()}
            {sold > 0 && <span style={{ color: "var(--text-secondary)", fontSize: 12 }}> / {record.shares}</span>}
          </span>
        );
      },
    },
    {
      title: "Buy Price",
      dataIndex: "buyPrice",
      key: "buyPrice",
      render: (v: number) => `$${v.toFixed(2)}`,
      align: "right" as const,
    },
    {
      title: "Current",
      key: "current",
      render: (_: unknown, record: AssetStock) => {
        if (quotesPending) return <QuoteCellSkeleton width={72} />;
        const price = quotes[record.symbol]?.currentPrice;
        return price ? `$${price.toFixed(2)}` : "—";
      },
      align: "right" as const,
    },
    {
      title: "Last Day",
      key: "lastDay",
      render: (_: unknown, record: AssetStock) => {
        if (quotesPending) return <QuoteCellSkeleton width={88} />;
        const movement = getDisplayLastDayMovement(record, quotes[record.symbol]);
        return movement ?
            <PnLDisplay value={movement.value} percentage={movement.percentage} size="small" />
          : <span style={{ color: "var(--text-secondary)" }}>—</span>;
      },
      align: "right" as const,
    },
    {
      title: "Sellable Value",
      key: "currentValue",
      render: (_: unknown, record: AssetStock) => {
        if (quotesPending) return <QuoteCellSkeleton width={96} />;
        const remaining = getRemainingShares(record);
        const currentPrice = quotes[record.symbol]?.currentPrice ?? record.buyPrice;
        return formatCurrency(remaining * currentPrice);
      },
      align: "right" as const,
    },
    {
      title: "P&L",
      key: "unrealized",
      render: (_: unknown, record: AssetStock) => {
        const remaining = getRemainingShares(record);
        if (remaining <= 0) {
          const realized = getRealizedPnL(record);
          if (realized === 0) return <span style={{ color: "var(--text-secondary)" }}>—</span>;
          return <PnLDisplay value={realized} percentage={getRealizedPnLPercent(record)} size="small" />;
        }
        if (quotesPending) return <QuoteCellSkeleton width={88} />;
        const curPrice = quotes[record.symbol]?.currentPrice || record.buyPrice;
        const costPerShare = getCostPerShare(record);
        const pnl = remaining * (curPrice - costPerShare);
        const pnlPct = ((curPrice - costPerShare) / costPerShare) * 100;
        return <PnLDisplay value={pnl} percentage={pnlPct} size="small" />;
      },
      align: "right" as const,
    },
    {
      title: "Campaign",
      key: "campaign",
      render: (_: unknown, record: AssetStock) => renderCampaignLink(record, "table-link"),
    },
    {
      title: "",
      key: "prepare",
      align: "right" as const,
      render: (_: unknown, record: AssetStock) =>
        isSoldOut(record) ? null : (
          <SellToggle flagged={Boolean(record.prepareToSell)} onToggle={() => togglePrepareToSell(record)} />
        ),
    },
  ];

  const renderStockTable = (stocks: AssetStock[]) => (
    <div className="desktop-stock-table campaigns-panel">
      <Table
        dataSource={toRows(stocks)}
        columns={stockColumns}
        pagination={false}
        scroll={{ x: 1080 }}
        rowClassName={(record) => (record.prepareToSell && !isSoldOut(record) ? "asset-prepare-sell-row" : "")}
      />
    </div>
  );

  const renderMobileStockCards = (stocks: AssetStock[]) => (
    <div className="mobile-stock-cards">
      <div className="mobile-stock-list">
        {stocks.map((stock) => {
          const soldOut = isSoldOut(stock);
          const flagged = Boolean(stock.prepareToSell) && !soldOut;
          const sold = getSoldShares(stock);
          const remaining = getRemainingShares(stock);
          const currentPrice = quotes[stock.symbol]?.currentPrice ?? stock.buyPrice;
          const costPerShare = getCostPerShare(stock);
          const unrealized = remaining * (currentPrice - costPerShare);
          const unrealizedPct = ((currentPrice - costPerShare) / costPerShare) * 100;
          const lastDayMovement = getDisplayLastDayMovement(stock, quotes[stock.symbol]);
          const realized = getRealizedPnL(stock);
          const realizedPct = getRealizedPnLPercent(stock);
          const soldPrice = getAverageSoldPrice(stock);

          return (
            <div
              key={`${stock.campaignId}-${stock._id}`}
              className={cn("mobile-stock-card", soldOut && "mobile-stock-card-sold", flagged && "mobile-stock-card-flagged")}>
              <div className="mobile-stock-card-header">
                <div className="mobile-stock-title">
                  <Button
                    type="link"
                    className={cn("mobile-stock-symbol stock-symbol-link", soldOut && "stock-symbol-link-sold")}
                    onClick={() => setDrawerSymbol(stock.symbol)}>
                    {stock.symbol} <LineChartOutlined style={{ fontSize: 11 }} />
                  </Button>
                </div>
                <div className="mobile-stock-header-actions">
                  {soldOut ?
                    <span className="campaign-status">Sold</span>
                  : <SellToggle flagged={flagged} onToggle={() => togglePrepareToSell(stock)} />}
                </div>
              </div>

              <div className="mobile-stock-metrics">
                {soldOut ?
                  <>
                    <div>
                      <span>Buy Price</span>
                      <strong>{formatCurrency(stock.buyPrice)}</strong>
                    </div>
                    <div>
                      <span>Sold Price</span>
                      <strong>{soldPrice != null ? formatCurrency(soldPrice) : "—"}</strong>
                    </div>
                    <div>
                      <span>Current</span>
                      {quotesPending ?
                        <QuoteCellSkeleton width={80} />
                      : <strong>{formatCurrency(currentPrice)}</strong>}
                    </div>
                    <div>
                      <span>Realized P&L</span>
                      {realized !== 0 ?
                        <PnLDisplay value={realized} percentage={realizedPct} size="small" />
                      : <strong className="neutral">—</strong>}
                    </div>
                  </>
                : <>
                    <div>
                      <span>Shares</span>
                      <strong>
                        {remaining.toLocaleString()}
                        {sold > 0 && <small> / {stock.shares.toLocaleString()}</small>}
                      </strong>
                    </div>
                    <div>
                      <span>Buy Price</span>
                      <strong>{formatCurrency(stock.buyPrice)}</strong>
                    </div>
                    <div>
                      <span>Current</span>
                      {quotesPending ?
                        <QuoteCellSkeleton width={80} />
                      : <strong>{formatCurrency(currentPrice)}</strong>}
                    </div>
                    <div>
                      <span>Last Day</span>
                      {quotesPending ?
                        <QuoteCellSkeleton width={88} />
                      : lastDayMovement ?
                        <PnLDisplay value={lastDayMovement.value} percentage={lastDayMovement.percentage} size="small" />
                      : <strong className="neutral">—</strong>}
                    </div>
                    <div>
                      <span>Sellable Value</span>
                      {quotesPending ?
                        <QuoteCellSkeleton width={96} />
                      : <strong>{formatCurrency(remaining * currentPrice)}</strong>}
                    </div>
                    <div>
                      <span>Unrealized</span>
                      {quotesPending ?
                        <QuoteCellSkeleton width={88} />
                      : <PnLDisplay value={unrealized} percentage={unrealizedPct} size="small" />}
                    </div>
                    <div>
                      <span>Realized</span>
                      {realized !== 0 ?
                        <PnLDisplay value={realized} size="small" />
                      : <strong className="neutral">—</strong>}
                    </div>
                  </>
                }
              </div>

              <div className="mobile-stock-funding">
                <span>Campaign</span>
                {renderCampaignLink(stock)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderChartCard = (stock: AssetStock) => {
    const soldOut = isSoldOut(stock);
    const flagged = Boolean(stock.prepareToSell) && !soldOut;
    const quote = quotes[stock.symbol];
    const currentPrice = quote?.currentPrice;
    const remaining = getRemainingShares(stock);
    const lastDayMovement = getDisplayLastDayMovement(stock, quote);
    const priceForPnl = currentPrice ?? stock.buyPrice;
    const costPerShare = getCostPerShare(stock);
    const unrealized = remaining * (priceForPnl - costPerShare);
    const unrealizedPct = ((priceForPnl - costPerShare) / costPerShare) * 100;
    const realized = getRealizedPnL(stock);
    const realizedPct = getRealizedPnLPercent(stock);
    const soldPrice = getAverageSoldPrice(stock);
    const alertRules: ChartAlertRule[] = (stock.notifications || []).map((notification) => ({
      id: notification._id,
      type: notification.type,
      targetPrice: notification.targetPrice,
      targetPercent: notification.targetPercent,
      referencePrice: notification.referencePrice,
      createdAt: notification.createdAt,
    }));

    const empty = <span className="neutral">—</span>;
    const currentPriceValue =
      quotesPending ? <QuoteCellSkeleton width={88} />
      : currentPrice != null ? formatCurrency(currentPrice)
      : empty;

    return (
      <div
        key={`${stock.campaignId}-${stock._id}`}
        className={cn("chart-stock-card", soldOut && "chart-stock-card-sold", flagged && "chart-stock-card-flagged")}>
        <div className="chart-stock-card-header">
          <div className="chart-stock-title">
            <span className="chart-stock-symbol">{stock.symbol}</span>
            {soldOut && <span className="campaign-status">Sold</span>}
            {renderCampaignLink(stock, "chart-stock-campaign")}
          </div>
          {!soldOut && <SellToggle flagged={flagged} onToggle={() => togglePrepareToSell(stock)} />}
        </div>
        <StockChart
          symbol={stock.symbol}
          height={220}
          hideToolbar
          activeRangeOverride={globalTimeRange}
          chartType={viewMode === "area" ? "area" : "candlestick"}
          markers={buildMarkers(stock)}
          alertRules={alertRules}
        />
        {(soldOut || viewMode === "area") && (
          <dl className="chart-stock-metrics">
            <div>
              <dt>Buy Price</dt>
              <dd>{formatCurrency(stock.buyPrice)}</dd>
            </div>
            {soldOut ?
              <>
                <div>
                  <dt>Sold Price</dt>
                  <dd>{soldPrice != null ? formatCurrency(soldPrice) : empty}</dd>
                </div>
                <div>
                  <dt>Current Price</dt>
                  <dd>{currentPriceValue}</dd>
                </div>
                <div>
                  <dt>Realized P&L</dt>
                  <dd>{realized !== 0 ? <PnLDisplay value={realized} percentage={realizedPct} size="small" /> : empty}</dd>
                </div>
              </>
            : <>
                <div>
                  <dt>Current Price</dt>
                  <dd>{currentPriceValue}</dd>
                </div>
                <div>
                  <dt>Last Day</dt>
                  <dd>
                    {quotesPending ?
                      <QuoteCellSkeleton width={88} />
                    : lastDayMovement ?
                      <PnLDisplay value={lastDayMovement.value} percentage={lastDayMovement.percentage} size="small" />
                    : empty}
                  </dd>
                </div>
                <div>
                  <dt>Unrealized P&L</dt>
                  <dd>
                    {quotesPending ?
                      <QuoteCellSkeleton width={88} />
                    : <PnLDisplay value={unrealized} percentage={unrealizedPct} size="small" />}
                  </dd>
                </div>
              </>
            }
          </dl>
        )}
      </div>
    );
  };

  const renderSoldSection = (content: React.ReactNode) => (
    <section className="campaigns-subsection" aria-labelledby="sold-positions-title">
      <h3 id="sold-positions-title" className="campaigns-section-title">
        Sold Positions <span className="campaigns-section-count">{soldStocks.length}</span>
      </h3>
      <p className="campaigns-section-footnote">Fully sold, kept for realized P&L.</p>
      {content}
    </section>
  );

  const showChartTimeRange = viewMode !== "list" && group.stocks.length > 0;

  return (
    <div className="page-container campaigns-page">
      <div className="page-header">
        <div className="campaign-page-heading">
          <BackToAssets />
          <h1>{group.name}</h1>
          <MetaLine
            parts={[formatStockSummary(activeStocks.length, group.stocks.length), pluralize(campaignCount, "campaign")]}
            className="campaign-page-subtitle"
          />
        </div>
      </div>

      {showChartTimeRange && (
        <div className="stocks-time-range-bar">
          <TimeRangeFilter value={globalTimeRange} onChange={setGlobalTimeRange} />
        </div>
      )}

      {/* The time-range bar stays outside the query container: on phones it is fixed to the viewport. */}
      <div className="campaigns-container">
        <CampaignSummary
          label="Sellable Value"
          value={stats.currentValue}
          pending={quotesPending}
          detail={`Invested ${formatCurrency(stats.invested)}`}
          metrics={summaryMetrics}
        />

        {prepareStocks.length > 0 && (
          <div className="sell-list-callout">
            <span className="sell-list-callout-text">
              <TagsFilled aria-hidden />
              <span>
                Preparing to sell {pluralize(prepareStocks.length, "position")} · {formatCurrency(prepareValue)}
              </span>
            </span>
            <Button type="text" onClick={clearPrepareToSell}>
              Clear All
            </Button>
          </div>
        )}

        <section className="campaigns-section" aria-labelledby="asset-stocks-title">
          <div className="campaigns-section-header">
            <h2 id="asset-stocks-title" className="campaigns-section-title">
              Stocks {activeStocks.length > 0 && <span className="campaigns-section-count">{activeStocks.length}</span>}
            </h2>
            <Segmented
              options={[
                { value: "list", icon: <UnorderedListOutlined />, title: "List" },
                { value: "candlestick", icon: <AppstoreOutlined />, title: "Candlestick charts" },
                { value: "area", icon: <LineChartOutlined />, title: "Area charts" },
              ]}
              value={viewMode}
              onChange={(v) => setViewMode(v as "list" | "candlestick" | "area")}
            />
          </div>

          {group.stocks.length === 0 ?
            <div className="campaigns-panel campaigns-panel-padded">
              <Empty
                description={<span style={{ color: "var(--text-secondary)" }}>No stocks in this account.</span>}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            </div>
          : viewMode === "list" ?
            <>
              {activeStocks.length > 0 && (
                <>
                  {renderStockTable(activeStocks)}
                  {renderMobileStockCards(activeStocks)}
                </>
              )}

              {soldStocks.length > 0 &&
                renderSoldSection(
                  <>
                    {renderStockTable(soldStocks)}
                    {renderMobileStockCards(soldStocks)}
                  </>,
                )}
            </>
          : <>
              {activeStocks.length > 0 && <div className="stock-chart-grid">{activeStocks.map(renderChartCard)}</div>}
              {soldStocks.length > 0 && renderSoldSection(<div className="stock-chart-grid">{soldStocks.map(renderChartCard)}</div>)}
            </>
          }
        </section>
      </div>

      <StockDetailDrawer symbol={drawerSymbol} open={!!drawerSymbol} onClose={() => setDrawerSymbol(null)} />
    </div>
  );
}
