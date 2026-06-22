"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Card, Button, Table, Tag, Statistic, Row, Col, Empty, Space, Segmented, Skeleton, message } from "antd";
import {
  ArrowLeftOutlined,
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
import StockChart, { ChartAlertRule, TimeRange, TIME_RANGES } from "@/components/charts/StockChart";
import StockDetailDrawer from "@/components/charts/StockDetailDrawer";
import PnLDisplay from "@/components/shared/PnLDisplay";
import { cn } from "@/lib/utils";
import {
  annualForStocks,
  AssetStock,
  buildAssetGroups,
  formatCurrency,
  getAverageSoldPrice,
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

const METRIC_LABEL_CLASS = "mb-1.5 block text-xs font-semibold leading-tight text-muted-foreground";
const METRIC_VALUE_CLASS = "block text-sm font-semibold";

const getPnLToneClass = (value: number) => {
  if (value > 0) return "border-green-500/30 bg-green-500/10";
  if (value < 0) return "border-destructive/30 bg-destructive/10";
  return "";
};

function AssetDetailSkeleton() {
  return (
    <div className="page-container">
      <div className="page-header">
        <div className="campaign-page-heading">
          <Skeleton.Button active size="small" style={{ width: 32 }} />
          <Skeleton.Input active size="large" style={{ width: 220 }} />
        </div>
      </div>
      <div className="stats-grid">
        {Array.from({ length: 5 }).map((_, index) => (
          <Card key={index} className="stat-card" bordered={false}>
            <Skeleton.Input active size="small" style={{ width: 96, marginBottom: 10 }} />
            <Skeleton.Input active size="large" style={{ width: 140 }} />
          </Card>
        ))}
      </div>
      <Card className="campaign-detail-card" bordered={false}>
        <Skeleton active paragraph={{ rows: 5 }} />
      </Card>
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

  const sorted = sortStarredFirst(group.stocks);
  const activeStocks = sorted.filter((stock) => !isSoldOut(stock));
  const soldStocks = sorted.filter(isSoldOut);
  const orderedStocks = [...activeStocks, ...soldStocks];
  const rows = orderedStocks.map((stock) => ({ ...stock, key: `${stock.campaignId}-${stock._id}` }));

  const prepareStocks = activeStocks.filter((stock) => stock.prepareToSell);
  const prepareValue = prepareStocks.reduce((sum, stock) => {
    const currentPrice = quotes[stock.symbol]?.currentPrice ?? stock.buyPrice;
    return sum + getRemainingShares(stock) * currentPrice;
  }, 0);

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
              style={{ fontWeight: 700, fontSize: 15, padding: 0, color: soldOut ? "#fca5a5" : undefined }}
              onClick={() => setDrawerSymbol(symbol)}>
              {symbol} <LineChartOutlined style={{ fontSize: 11 }} />
            </Button>
            {soldOut && <Tag color="red">Sold</Tag>}
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
            {sold > 0 && <span style={{ color: "#64748b", fontSize: 12 }}> / {record.shares}</span>}
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
          : <span style={{ color: "#64748b" }}>—</span>;
      },
      align: "right" as const,
    },
    {
      title: "Value (sellable)",
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
          if (realized === 0) return <span style={{ color: "#64748b" }}>—</span>;
          return <PnLDisplay value={realized} percentage={getRealizedPnLPercent(record)} size="small" />;
        }
        if (quotesPending) return <QuoteCellSkeleton width={88} />;
        const curPrice = quotes[record.symbol]?.currentPrice || record.buyPrice;
        const pnl = remaining * (curPrice - record.buyPrice);
        const pnlPct = ((curPrice - record.buyPrice) / record.buyPrice) * 100;
        return <PnLDisplay value={pnl} percentage={pnlPct} size="small" />;
      },
      align: "right" as const,
    },
    {
      title: "Campaign",
      key: "campaign",
      render: (_: unknown, record: AssetStock) => (
        <Button
          type="link"
          style={{ padding: 0, height: "auto", fontSize: 13 }}
          onClick={() => record.campaignId && router.push(`/campaigns/${record.campaignId}`)}>
          {record.campaignName}
        </Button>
      ),
    },
    {
      title: "",
      key: "prepare",
      align: "right" as const,
      render: (_: unknown, record: AssetStock) => {
        if (isSoldOut(record)) return null;
        const flagged = Boolean(record.prepareToSell);
        return (
          <Button
            size="small"
            icon={flagged ? <TagsFilled /> : <TagOutlined />}
            onClick={() => togglePrepareToSell(record)}
            style={
              flagged ?
                { background: "#f59e0b", borderColor: "#f59e0b", color: "#1a1205" }
              : { borderColor: "#3a4a5e", color: "#94a3b8" }
            }>
            {flagged ? "Selling" : "Prepare"}
          </Button>
        );
      },
    },
  ];

  const renderChartGrid = (stocks: AssetStock[]) => (
    <Row gutter={[24, 24]}>
      {stocks.map((stock) => {
        const soldOut = isSoldOut(stock);
        const quote = quotes[stock.symbol];
        const currentPrice = quote?.currentPrice;
        const remaining = getRemainingShares(stock);
        const lastDayMovement = getDisplayLastDayMovement(stock, quote);
        const priceForPnl = currentPrice ?? stock.buyPrice;
        const unrealized = remaining * (priceForPnl - stock.buyPrice);
        const unrealizedPct = ((priceForPnl - stock.buyPrice) / stock.buyPrice) * 100;
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

        const flagged = Boolean(stock.prepareToSell) && !soldOut;

        return (
          <Col key={`${stock.campaignId}-${stock._id}`} xs={24} lg={12}>
            <div
              className={`chart-stock-card ${soldOut ? "chart-stock-card-sold" : ""}`}
              style={{
                background:
                  soldOut ? "rgba(127, 29, 29, 0.14)"
                  : flagged ? "rgba(120, 53, 15, 0.18)"
                  : "#0f1629",
                border:
                  soldOut ? "1px solid rgba(248, 113, 113, 0.35)"
                  : flagged ? "1px solid rgba(245, 158, 11, 0.55)"
                  : "1px solid #1e2a3a",
                overflow: "hidden",
              }}>
              <div
                className="chart-stock-card-header"
                style={{
                  padding: "12px 16px",
                  borderBottom: soldOut ? "1px solid rgba(248, 113, 113, 0.28)" : "1px solid #1e2a3a",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}>
                <Space size="small">
                  <span style={{ fontWeight: 700, fontSize: 16, color: "#e2e8f0" }}>{stock.symbol}</span>
                  {soldOut && <Tag color="red">Sold</Tag>}
                  {flagged && <Tag color="gold">Selling</Tag>}
                </Space>
                <Space size="small">
                  {!soldOut && (
                    <Button
                      size="small"
                      icon={flagged ? <TagsFilled /> : <TagOutlined />}
                      onClick={() => togglePrepareToSell(stock)}
                      title={flagged ? "Remove from sell list" : "Prepare to sell"}
                      style={
                        flagged ?
                          { background: "#f59e0b", borderColor: "#f59e0b", color: "#1a1205" }
                        : { borderColor: "#3a4a5e", color: "#94a3b8" }
                      }
                    />
                  )}
                  <Button
                    type="link"
                    style={{ padding: 0, height: "auto", fontSize: 12, color: "#94a3b8" }}
                    onClick={() => stock.campaignId && router.push(`/campaigns/${stock.campaignId}`)}>
                    {stock.campaignName}
                  </Button>
                </Space>
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
                <div className="grid grid-cols-2 overflow-hidden">
                  {soldOut ?
                    <>
                      <div className="min-w-0 border border-border bg-card/50 p-2.5">
                        <span className={METRIC_LABEL_CLASS}>Buy Price</span>
                        <span className={cn(METRIC_VALUE_CLASS, "text-foreground")}>{formatCurrency(stock.buyPrice)}</span>
                      </div>
                      <div className="min-w-0 border border-border bg-card/50 p-2.5">
                        <span className={METRIC_LABEL_CLASS}>Sold Price</span>
                        <span className={cn(METRIC_VALUE_CLASS, "text-foreground")}>
                          {soldPrice != null ? formatCurrency(soldPrice) : "—"}
                        </span>
                      </div>
                      <div className="min-w-0 border border-border bg-card/50 p-2.5 rounded-bl-lg">
                        <span className={METRIC_LABEL_CLASS}>Current Price</span>
                        {quotesPending ?
                          <QuoteCellSkeleton width={88} />
                        : currentPrice != null ?
                          <span className={cn(METRIC_VALUE_CLASS, "text-foreground")}>{formatCurrency(currentPrice)}</span>
                        : <span className={cn(METRIC_VALUE_CLASS, "text-muted-foreground")}>—</span>}
                      </div>
                      <div className={cn("min-w-0 border !border-neutral-500/10 bg-card/50 p-2.5 rounded-br-lg", getPnLToneClass(realized))}>
                        <span className={METRIC_LABEL_CLASS}>Realized P&L</span>
                        {realized !== 0 ?
                          <PnLDisplay value={realized} percentage={realizedPct} size="small" />
                        : <span className={cn(METRIC_VALUE_CLASS, "text-muted-foreground")}>—</span>}
                      </div>
                    </>
                  : <>
                      <div className="min-w-0 border border-border bg-card/50 p-2.5">
                        <span className={METRIC_LABEL_CLASS}>Buy Price</span>
                        <span className={cn(METRIC_VALUE_CLASS, "text-foreground")}>{formatCurrency(stock.buyPrice)}</span>
                      </div>
                      <div className="min-w-0 border border-border p-2.5">
                        <span className={METRIC_LABEL_CLASS}>Current Price</span>
                        {quotesPending ?
                          <QuoteCellSkeleton width={88} />
                        : currentPrice != null ?
                          <span className={cn(METRIC_VALUE_CLASS, "text-foreground")}>{formatCurrency(currentPrice)}</span>
                        : <span className={cn(METRIC_VALUE_CLASS, "text-muted-foreground")}>—</span>}
                      </div>
                      <div
                        className={cn(
                          "min-w-0 border !border-neutral-500/10 bg-card/50 p-2.5 rounded-bl-lg",
                          lastDayMovement && getPnLToneClass(lastDayMovement.value),
                        )}>
                        <span className={METRIC_LABEL_CLASS}>Last Day</span>
                        {quotesPending ?
                          <QuoteCellSkeleton width={88} />
                        : lastDayMovement ?
                          <PnLDisplay value={lastDayMovement.value} percentage={lastDayMovement.percentage} size="small" />
                        : <span className={cn(METRIC_VALUE_CLASS, "text-muted-foreground")}>—</span>}
                      </div>
                      <div className={cn("min-w-0 border !border-neutral-500/10 bg-card/50 p-2.5 rounded-br-lg", getPnLToneClass(unrealized))}>
                        <span className={METRIC_LABEL_CLASS}>Unrealized P&L</span>
                        {quotesPending ?
                          <QuoteCellSkeleton width={88} />
                        : <PnLDisplay value={unrealized} percentage={unrealizedPct} size="small" />}
                      </div>
                    </>
                  }
                </div>
              )}
            </div>
          </Col>
        );
      })}
    </Row>
  );

  const showChartTimeRange = viewMode !== "list" && group.stocks.length > 0;

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="campaign-page-heading">
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push("/assets")} type="text" />
          <h1>{group.name}</h1>
        </div>
        <Segmented
          options={[
            { value: "list", icon: <UnorderedListOutlined /> },
            { value: "candlestick", icon: <AppstoreOutlined /> },
            { value: "area", icon: <LineChartOutlined /> },
          ]}
          value={viewMode}
          onChange={(v) => setViewMode(v as "list" | "candlestick" | "area")}
        />
      </div>

      {showChartTimeRange && (
        <div className="stocks-time-range-bar">
          <div className="time-range-group">
            {TIME_RANGES.map((r) => (
              <button
                key={r.key}
                className={`time-range-btn ${globalTimeRange === r.key ? "active" : ""}`}
                onClick={() => setGlobalTimeRange(r.key)}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Asset summary metrics */}
      <div className="stats-grid animate-in">
        <Card className="stat-card" bordered={false}>
          <div style={{ color: "#64748b", fontSize: 14, marginBottom: 8 }}>Invested</div>
          <Statistic
            value={stats.invested}
            precision={2}
            valueStyle={{ color: "#e2e8f0" }}
            formatter={(v) => formatCurrency(Number(v))}
          />
        </Card>
        <Card className="stat-card" bordered={false}>
          <div style={{ color: "#64748b", fontSize: 14, marginBottom: 8 }}>Sellable Value</div>
          {quotesPending ?
            <Skeleton.Input active size="large" style={{ width: 160 }} />
          : <Statistic
              value={stats.currentValue}
              precision={2}
              valueStyle={{ color: "#e2e8f0" }}
              formatter={(v) => formatCurrency(Number(v))}
            />
          }
        </Card>
        <Card className="stat-card" bordered={false}>
          <div style={{ color: "#64748b", fontSize: 14, marginBottom: 8 }}>Last Day</div>
          {quotesPending ?
            <Skeleton.Input active size="large" style={{ width: 160 }} />
          : <PnLDisplay value={lastDay.value} percentage={lastDay.percentage} size="large" />}
        </Card>
        <Card className="stat-card" bordered={false}>
          <div style={{ color: "#64748b", fontSize: 14, marginBottom: 8 }}>Total P&L</div>
          {quotesPending ?
            <Skeleton.Input active size="large" style={{ width: 160 }} />
          : <PnLDisplay value={stats.pnl} percentage={stats.pnlPercent} size="large" />}
        </Card>
        <Card className="stat-card" bordered={false}>
          <div style={{ color: "#64748b", fontSize: 14, marginBottom: 8 }}>Annual P&L</div>
          {quotesPending || periodPricesPending ?
            <Skeleton.Input active size="large" style={{ width: 160 }} />
          : <PnLDisplay value={annual.pnl} percentage={annual.pnlPercent} size="large" />}
        </Card>
      </div>

      {/* Prepare-to-sell summary */}
      {prepareStocks.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            background: "rgba(120, 53, 15, 0.18)",
            border: "1px solid rgba(245, 158, 11, 0.5)",
            borderRadius: 12,
            padding: "12px 16px",
            marginBottom: 16,
          }}>
          <span style={{ color: "#fbbf24", fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
            <TagsFilled />
            Preparing to sell: {prepareStocks.length} position{prepareStocks.length === 1 ? "" : "s"} ·{" "}
            {formatCurrency(prepareValue)}
          </span>
          <Button size="small" onClick={clearPrepareToSell}>
            Clear all
          </Button>
        </div>
      )}

      {/* Stocks */}
      <Card
        className="campaign-detail-card"
        bordered={false}
        title={
          <span style={{ color: "#e2e8f0", fontSize: 16, fontWeight: 700 }}>
            Stocks{" "}
            <span style={{ color: "#64748b", fontSize: 13, fontWeight: 400 }}>
              · {activeStocks.length} active{soldStocks.length > 0 ? `, ${soldStocks.length} sold` : ""}
            </span>
          </span>
        }>
        {group.stocks.length === 0 ?
          <Empty description={<span style={{ color: "#64748b" }}>No stocks in this account.</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        : viewMode === "list" ?
          <div className="desktop-stock-table">
            <Table
              dataSource={rows}
              columns={stockColumns}
              pagination={false}
              scroll={{ x: 1080 }}
              rowClassName={(record) => (record.prepareToSell && !isSoldOut(record) ? "asset-prepare-sell-row" : "")}
            />
          </div>
        : renderChartGrid(orderedStocks)}
      </Card>

      <StockDetailDrawer symbol={drawerSymbol} open={!!drawerSymbol} onClose={() => setDrawerSymbol(null)} />
    </div>
  );
}
