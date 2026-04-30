"use client";

import React, { useState, useMemo } from "react";
import {
  Card,
  Button,
  Table,
  Tag,
  Empty,
  Spin,
  Modal,
  Form,
  InputNumber,
  Input,
  message,
  Popconfirm,
  Row,
  Col,
  Segmented,
  Space,
} from "antd";
import { PlusOutlined, EyeOutlined, DeleteOutlined, UnorderedListOutlined, AppstoreOutlined, LineChartOutlined } from "@ant-design/icons";
import { useStore } from "@/context/StoreContext";
import { useStockQuotes } from "@/hooks/useStockQuote";
import SymbolSearch from "@/components/shared/SymbolSearch";
import StockDetailDrawer from "@/components/charts/StockDetailDrawer";
import StockChart, { ChartAlertRule, TimeRange, TIME_RANGES } from "@/components/charts/StockChart";
import PnLDisplay from "@/components/shared/PnLDisplay";
import { WatchlistItem } from "@/types";

const hasValidQuote = (quote?: { currentPrice: number }): quote is { currentPrice: number } =>
  Boolean(quote && Number.isFinite(quote.currentPrice) && quote.currentPrice > 0);

export default function WatchlistPage() {
  const { state, dispatch } = useStore();
  const [addModal, setAddModal] = useState(false);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [drawerSymbol, setDrawerSymbol] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "candlestick" | "area">("list");
  const [globalTimeRange, setGlobalTimeRange] = useState<TimeRange>("1Y");

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

  const columns = [
    {
      title: "Symbol",
      dataIndex: "symbol",
      key: "symbol",
      render: (s: string) => (
        <Button type="link" style={{ fontWeight: 700, padding: 0 }} onClick={() => setDrawerSymbol(s)}>
          {s}
        </Button>
      ),
    },
    {
      title: "Current Price",
      key: "current",
      render: (_: unknown, record: { symbol: string }) => {
        const q = quotes[record.symbol];
        return hasValidQuote(q) ? `$${q.currentPrice.toFixed(2)}` : "—";
      },
      align: "right" as const,
    },
    {
      title: "Target Buy",
      dataIndex: "targetBuyPrice",
      key: "target",
      render: (v: number) => <span style={{ color: "#00d4aa", fontWeight: 600 }}>${v.toFixed(2)}</span>,
      align: "right" as const,
    },
    {
      title: "Distance",
      key: "distance",
      render: (_: unknown, record: { symbol: string; targetBuyPrice: number }) => {
        const q = quotes[record.symbol];
        if (!hasValidQuote(q)) return "—";
        const dist = ((q.currentPrice - record.targetBuyPrice) / q.currentPrice) * 100;
        const atTarget = q.currentPrice <= record.targetBuyPrice;
        return atTarget ?
            <Tag color="green">🎯 At Target!</Tag>
          : <PnLDisplay value={-dist} percentage={-dist} showArrow={false} size="small" prefix="" />;
      },
      align: "right" as const,
    },
    { title: "Notes", dataIndex: "notes", key: "notes", render: (n: string) => <span style={{ color: "#94a3b8" }}>{n || "—"}</span> },
    {
      title: "",
      key: "actions",
      width: 100,
      render: (_: unknown, record: { _id?: string }) => (
        <Popconfirm title="Remove from watchlist?" onConfirm={() => handleDelete(record._id!)}>
          <Button type="text" danger icon={<DeleteOutlined />} size="small" />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Watchlist</h1>
        <Button type="primary" icon={<PlusOutlined />} size="large" onClick={() => setAddModal(true)}>
          Add Stock
        </Button>
      </div>

      {state.watchlist.length === 0 ?
        <div className="empty-state">
          <EyeOutlined className="empty-state-icon" />
          <p className="empty-state-text">Your watchlist is empty. Add stocks you&apos;re waiting to buy.</p>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModal(true)}>
            Add to Watchlist
          </Button>
        </div>
      : <Card
          bordered={false}
          title={
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 16 }}>
              <span style={{ color: "#e2e8f0", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                Stocks
                {viewMode !== "list" && (
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
                )}
              </span>
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
          }>
          {viewMode === "list" ?
            <Table
              dataSource={state.watchlist.map((w) => ({ ...w, key: w._id }))}
              columns={columns}
              pagination={false}
              rowClassName={(record) => {
                const q = quotes[record.symbol];
                return hasValidQuote(q) && q.currentPrice <= record.targetBuyPrice ? "gain" : "";
              }}
            />
          : <Row gutter={[24, 24]}>
              {state.watchlist.map((item: WatchlistItem) => {
                const q = quotes[item.symbol];
                const validQuote = hasValidQuote(q);
                const distance = validQuote ? ((q.currentPrice - item.targetBuyPrice) / q.currentPrice) * 100 : null;
                const alertRules: ChartAlertRule[] = [
                  {
                    type: "below",
                    targetPrice: item.targetBuyPrice,
                    referencePrice: validQuote ? q.currentPrice : item.targetBuyPrice,
                    createdAt: item.createdAt,
                  },
                ];

                return (
                  <Col key={item._id || item.symbol} xs={24} lg={12}>
                    <div style={{ background: "#0f1629", borderRadius: 12, border: "1px solid #1e2a3a", overflow: "hidden" }}>
                      <div
                        style={{
                          padding: "12px 16px",
                          borderBottom: "1px solid #1e2a3a",
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          alignItems: "center",
                        }}>
                        <Space size="small" wrap>
                          <Button
                            type="link"
                            style={{ fontWeight: 700, padding: 0, fontSize: 16 }}
                            onClick={() => setDrawerSymbol(item.symbol)}>
                            {item.symbol}
                          </Button>
                          {validQuote && q.currentPrice <= item.targetBuyPrice && <Tag color="green">At Target</Tag>}
                        </Space>
                        <Space size="small" wrap>
                          <span style={{ color: "#94a3b8", fontSize: 12 }}>Target ${item.targetBuyPrice.toFixed(2)}</span>
                          {distance != null && (
                            <PnLDisplay value={-distance} percentage={-distance} showArrow={false} size="small" prefix="" />
                          )}
                          <Popconfirm title="Remove from watchlist?" onConfirm={() => item._id && handleDelete(item._id)}>
                            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
                          </Popconfirm>
                        </Space>
                      </div>
                      <StockChart
                        symbol={item.symbol}
                        height={260}
                        hideToolbar
                        activeRangeOverride={globalTimeRange}
                        chartType={viewMode === "area" ? "area" : "candlestick"}
                        alertRules={alertRules}
                      />
                    </div>
                  </Col>
                );
              })}
            </Row>
          }
        </Card>
      }

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
