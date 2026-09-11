"use client";

import React, { useState, useMemo } from "react";
import { Button, Spin, Modal, Form, InputNumber, Input, message, Popconfirm, Segmented } from "antd";
import { PlusOutlined, EyeOutlined, DeleteOutlined, UnorderedListOutlined, AppstoreOutlined, LineChartOutlined } from "@ant-design/icons";
import { useStore } from "@/context/StoreContext";
import { useStockQuotes } from "@/hooks/useStockQuote";
import SymbolSearch from "@/components/shared/SymbolSearch";
import StockDetailDrawer from "@/components/charts/StockDetailDrawer";
import StockChart, { ChartAlertRule, TimeRange } from "@/components/charts/StockChart";
import TimeRangeFilter from "@/components/charts/TimeRangeFilter";
import PnLDisplay from "@/components/shared/PnLDisplay";
import { formatUsd } from "@/lib/campaignFormat";
import { getQuoteLastDayMovement } from "@/lib/assets";
import { StockQuote, WatchlistItem } from "@/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const hasValidQuote = (quote?: { currentPrice: number }): quote is { currentPrice: number } =>
  Boolean(quote && Number.isFinite(quote.currentPrice) && quote.currentPrice > 0);

const getTargetStatus = (item: WatchlistItem, quote?: StockQuote) => {
  const currentPrice = hasValidQuote(quote) ? quote.currentPrice : null;

  return {
    currentPrice,
    atTarget: currentPrice != null && currentPrice <= item.targetBuyPrice,
    // How far the price still has to fall, as a share of today's price.
    distance: currentPrice != null ? ((currentPrice - item.targetBuyPrice) / currentPrice) * 100 : null,
  };
};

const TargetCapsule = () => <span className="campaign-status campaign-status-target">At Target</span>;

export default function WatchlistPage() {
  const { state, dispatch } = useStore();
  const [addModal, setAddModal] = useState(false);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [drawerSymbol, setDrawerSymbol] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "candlestick" | "area">("list");
  const [globalTimeRange, setGlobalTimeRange] = useState<TimeRange>("3M");

  const symbols = useMemo(() => state.watchlist.map((w) => w.symbol), [state.watchlist]);
  const { quotes } = useStockQuotes(symbols);

  const handleAdd = async () => {
    try {
      const values = await form.validateFields();
      if (!selectedSymbol) {
        message.error("Select a symbol");
        return;
      }
      setLoading(true);
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: selectedSymbol, targetBuyPrice: values.targetBuyPrice, notes: values.notes || "" }),
      });
      if (res.ok) {
        const item = await res.json();
        dispatch({ type: "ADD_WATCHLIST_ITEM", payload: item });
        form.resetFields();
        setSelectedSymbol("");
        setAddModal(false);
        message.success("Added to watchlist");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/watchlist/${id}`, { method: "DELETE" });
      if (res.ok) {
        dispatch({ type: "DELETE_WATCHLIST_ITEM", payload: id });
        message.success("Removed");
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (state.loading)
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
        <Spin size="large" />
      </div>
    );

  const empty = <span className="neutral">—</span>;

  const renderDistance = ({ atTarget, distance }: ReturnType<typeof getTargetStatus>) =>
    atTarget ? "Reached"
    : distance != null ? `${distance.toFixed(2)}% above`
    : "—";

  const renderLastDay = (quote?: StockQuote, fallback: React.ReactNode = empty) => {
    const movement = getQuoteLastDayMovement(quote);
    return movement ? <PnLDisplay value={movement.value} percentage={movement.percentage} size="small" /> : fallback;
  };

  const renderRemoveButton = (item: WatchlistItem) => (
    <Popconfirm title="Remove from watchlist?" onConfirm={() => item._id && handleDelete(item._id)}>
      <Button
        type="text"
        danger
        icon={<DeleteOutlined />}
        size="small"
        aria-label={`Remove ${item.symbol} from watchlist`}
        style={{ width: 36, height: 36 }}
      />
    </Popconfirm>
  );

  const renderSymbolButton = (item: WatchlistItem, className: string) => (
    <Button type="link" className={className} onClick={() => setDrawerSymbol(item.symbol)}>
      {item.symbol} <LineChartOutlined style={{ fontSize: 11 }} />
    </Button>
  );

  const renderChartCard = (item: WatchlistItem) => {
    const quote = quotes[item.symbol];
    const status = getTargetStatus(item, quote);
    const alertRules: ChartAlertRule[] = [
      {
        type: "below",
        targetPrice: item.targetBuyPrice,
        referencePrice: status.currentPrice ?? item.targetBuyPrice,
        createdAt: item.createdAt,
      },
    ];

    return (
      <div key={item._id || item.symbol} className="chart-stock-card">
        <div className="chart-stock-card-header">
          <div className="chart-stock-title">
            <button type="button" className="chart-stock-symbol" onClick={() => setDrawerSymbol(item.symbol)}>
              {item.symbol}
            </button>
            {status.atTarget && <TargetCapsule />}
          </div>
          {renderRemoveButton(item)}
        </div>
        <StockChart
          symbol={item.symbol}
          height={220}
          hideToolbar
          activeRangeOverride={globalTimeRange}
          chartType={viewMode === "area" ? "area" : "candlestick"}
          alertRules={alertRules}
        />
        <dl className="chart-stock-metrics">
          <div>
            <dt>Current Price</dt>
            <dd>{status.currentPrice != null ? formatUsd(status.currentPrice) : empty}</dd>
          </div>
          <div>
            <dt>Target Buy</dt>
            <dd>{formatUsd(item.targetBuyPrice)}</dd>
          </div>
          <div>
            <dt>Distance</dt>
            <dd>{renderDistance(status)}</dd>
          </div>
          <div>
            <dt>Last Day</dt>
            <dd>{renderLastDay(quote)}</dd>
          </div>
        </dl>
      </div>
    );
  };

  const showChartTimeRange = viewMode !== "list" && state.watchlist.length > 0;

  return (
    <div className="page-container campaigns-page">
      <div className="page-header">
        <h1>Watchlist</h1>
        <Button
          type="primary"
          shape="round"
          size="large"
          icon={<PlusOutlined />}
          className="campaigns-primary-action"
          onClick={() => setAddModal(true)}>
          Add Stock
        </Button>
      </div>

      {showChartTimeRange && (
        <div className="stocks-time-range-bar">
          <TimeRangeFilter value={globalTimeRange} onChange={setGlobalTimeRange} />
        </div>
      )}

      {/* The time-range bar stays outside the query container: on phones it is fixed to the viewport. */}
      <div className="campaigns-container">
        {state.watchlist.length === 0 ?
          <div className="empty-state">
            <EyeOutlined className="empty-state-icon" />
            <p className="empty-state-text">Your watchlist is empty. Add stocks you&apos;re waiting to buy.</p>
            <Button
              type="primary"
              shape="round"
              size="large"
              icon={<PlusOutlined />}
              className="campaigns-primary-action"
              onClick={() => setAddModal(true)}>
              Add to Watchlist
            </Button>
          </div>
        : <section className="campaigns-section" aria-labelledby="watchlist-stocks-title">
            <div className="campaigns-section-header">
              <h2 id="watchlist-stocks-title" className="campaigns-section-title">
                Stocks <span className="campaigns-section-count">{state.watchlist.length}</span>
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

            {viewMode === "list" ?
              <>
                <div className="desktop-stock-table campaigns-panel">
                  <Table aria-label="Watchlist stocks" className="min-w-[760px] tabular-nums">
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">Symbol</TableHead>
                        <TableHead scope="col" className="text-right">
                          Current Price
                        </TableHead>
                        <TableHead scope="col" className="text-right">
                          Target Buy
                        </TableHead>
                        <TableHead scope="col" className="text-right">
                          Distance
                        </TableHead>
                        <TableHead scope="col" className="text-right">
                          Last Day
                        </TableHead>
                        <TableHead scope="col">Notes</TableHead>
                        <TableHead scope="col" className="text-right">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {state.watchlist.map((item) => {
                        const quote = quotes[item.symbol];
                        const status = getTargetStatus(item, quote);

                        return (
                          <TableRow key={item._id ?? item.symbol} className={status.atTarget ? "watchlist-row-target" : undefined}>
                            <TableCell>{renderSymbolButton(item, "stock-symbol-link")}</TableCell>
                            <TableCell className="text-right">
                              {status.currentPrice != null ? formatUsd(status.currentPrice) : "—"}
                            </TableCell>
                            <TableCell className="text-right font-semibold text-foreground">{formatUsd(item.targetBuyPrice)}</TableCell>
                            <TableCell className="text-right">{status.atTarget ? <TargetCapsule /> : renderDistance(status)}</TableCell>
                            <TableCell className="text-right">{renderLastDay(quote)}</TableCell>
                            <TableCell className="min-w-52 max-w-80 whitespace-pre-wrap break-words text-muted-foreground">
                              {item.notes || "—"}
                            </TableCell>
                            <TableCell className="text-right">{renderRemoveButton(item)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                <div className="mobile-stock-cards">
                  <div className="mobile-stock-list">
                    {state.watchlist.map((item) => {
                      const quote = quotes[item.symbol];
                      const status = getTargetStatus(item, quote);

                      return (
                        <div key={item._id ?? item.symbol} className="mobile-stock-card">
                          <div className="mobile-stock-card-header">
                            <div className="mobile-stock-title">{renderSymbolButton(item, "mobile-stock-symbol stock-symbol-link")}</div>
                            <div className="mobile-stock-header-actions">
                              {status.atTarget && <TargetCapsule />}
                              {renderRemoveButton(item)}
                            </div>
                          </div>
                          <div className="mobile-stock-metrics">
                            <div>
                              <span>Current</span>
                              <strong>{status.currentPrice != null ? formatUsd(status.currentPrice) : "—"}</strong>
                            </div>
                            <div>
                              <span>Target Buy</span>
                              <strong>{formatUsd(item.targetBuyPrice)}</strong>
                            </div>
                            <div>
                              <span>Distance</span>
                              <strong>{renderDistance(status)}</strong>
                            </div>
                            <div>
                              <span>Last Day</span>
                              {renderLastDay(quote, <strong className="neutral">—</strong>)}
                            </div>
                          </div>
                          {item.notes && <p className="mobile-stock-note">{item.notes}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            : <div className="stock-chart-grid">{state.watchlist.map(renderChartCard)}</div>}
          </section>
        }
      </div>

      <Modal title="Add to Watchlist" open={addModal} onCancel={() => setAddModal(false)} footer={null} destroyOnClose width={440}>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="Stock Symbol" required>
            <SymbolSearch onSelect={(s) => setSelectedSymbol(s)} />
          </Form.Item>
          <Form.Item name="targetBuyPrice" label="Target Buy Price" rules={[{ required: true, message: "Enter target price" }]}>
            <InputNumber prefix="$" style={{ width: "100%" }} size="large" min={0} step={0.01} />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={2} placeholder="Why are you watching this stock?" />
          </Form.Item>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button onClick={() => setAddModal(false)}>Cancel</Button>
            <Button type="primary" onClick={handleAdd} loading={loading}>
              Add
            </Button>
          </div>
        </Form>
      </Modal>

      <StockDetailDrawer symbol={drawerSymbol} open={!!drawerSymbol} onClose={() => setDrawerSymbol(null)} />
    </div>
  );
}
