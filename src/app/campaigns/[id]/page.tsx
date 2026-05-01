"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Card,
  Button,
  Table,
  Tag,
  Statistic,
  Row,
  Col,
  Spin,
  Empty,
  Space,
  Input,
  Select,
  InputNumber,
  message,
  Popconfirm,
  Divider,
  Segmented,
  Progress,
  Modal,
  Form,
  Radio,
  List,
  Typography,
} from "antd";
import {
  PlusOutlined,
  ArrowLeftOutlined,
  BankOutlined,
  DeleteOutlined,
  DollarOutlined,
  TrophyOutlined,
  RiseOutlined,
  FallOutlined,
  LineChartOutlined,
  UnorderedListOutlined,
  AppstoreOutlined,
  BellOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons";
import { useRouter, useParams } from "next/navigation";
import { useStore } from "@/context/StoreContext";
import { useStockQuotes } from "@/hooks/useStockQuote";
import { Campaign, CampaignStock, MoneyLocation, StockNotification, StockQuote } from "@/types";
import AddStockModal from "@/components/campaigns/AddStockModal";
import SellStockModal from "@/components/campaigns/SellStockModal";
import EditStockModal from "@/components/campaigns/EditStockModal";
import EditTransactionModal from "@/components/campaigns/EditTransactionModal";
import StockChart, { ChartAlertRule, TimeRange, TIME_RANGES } from "@/components/charts/StockChart";
import StockDetailDrawer from "@/components/charts/StockDetailDrawer";
import PnLDisplay from "@/components/shared/PnLDisplay";
import { calculateCampaignStats } from "@/lib/campaignStats";

type LocationBalance = {
  bought: number;
  sold: number;
  costBasis: number;
  currentValue: number;
  remaining: number;
  stockCount: number;
};

type LastDayMovement = {
  value: number;
  percentage: number;
};

const formatCurrency = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const getNotificationTargetPrice = (notification: StockNotification) => {
  if (notification.targetPrice != null) return notification.targetPrice;
  if (notification.targetPercent == null) return null;

  const multiplier = notification.type === "above" ? 1 + notification.targetPercent / 100 : 1 - notification.targetPercent / 100;

  return notification.referencePrice * multiplier;
};

const formatNotification = (notification: StockNotification) => {
  const direction = notification.type === "above" ? "Goes above" : "Drops below";
  const targetPrice = getNotificationTargetPrice(notification);
  const target =
    notification.targetPrice != null ?
      formatCurrency(notification.targetPrice)
    : `${notification.targetPercent}% (${targetPrice ? formatCurrency(targetPrice) : "—"})`;

  return `${direction} ${target}`;
};

const getSoldShares = (stock: CampaignStock) => stock.transactions.reduce((sum, transaction) => sum + transaction.shares, 0);

const getRemainingShares = (stock: CampaignStock) => Math.max(stock.shares - getSoldShares(stock), 0);

const isSoldOut = (stock: CampaignStock) => getRemainingShares(stock) <= 0;

const sortStarredFirst = (stocks: CampaignStock[]) =>
  [...stocks].sort((a, b) => Number(Boolean(b.isStarred)) - Number(Boolean(a.isStarred)));

const getQuoteLastDayMovement = (quote?: StockQuote): LastDayMovement | null => {
  if (!quote) return null;
  const change =
    isFiniteNumber(quote.change) ? quote.change
    : isFiniteNumber(quote.currentPrice) && isFiniteNumber(quote.previousClose) ? quote.currentPrice - quote.previousClose
    : null;

  if (change == null) return null;

  const percentage =
    isFiniteNumber(quote.percentChange) ? quote.percentChange
    : isFiniteNumber(quote.previousClose) && quote.previousClose !== 0 ? (change / quote.previousClose) * 100
    : 0;

  return {
    value: change,
    percentage,
  };
};

const getLastDayMovement = (stock: CampaignStock, quote?: StockQuote): LastDayMovement | null => {
  const remainingShares = getRemainingShares(stock);
  const movement = getQuoteLastDayMovement(quote);
  if (remainingShares <= 0 || !movement) return null;

  return {
    value: remainingShares * movement.value,
    percentage: movement.percentage,
  };
};

const getDisplayLastDayMovement = (stock: CampaignStock, quote?: StockQuote): LastDayMovement | null => {
  return getLastDayMovement(stock, quote) ?? getQuoteLastDayMovement(quote);
};

export default function CampaignDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { state, dispatch } = useStore();
  const [notificationForm] = Form.useForm();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [addStockModal, setAddStockModal] = useState(false);
  const [buyMoreStock, setBuyMoreStock] = useState<CampaignStock | null>(null);
  const [sellStock, setSellStock] = useState<CampaignStock | null>(null);
  const [editStock, setEditStock] = useState<CampaignStock | null>(null);
  const [editTransaction, setEditTransaction] = useState<{ stock: CampaignStock; transaction: any } | null>(null);
  const [notificationStock, setNotificationStock] = useState<CampaignStock | null>(null);
  const [savingNotification, setSavingNotification] = useState(false);
  const [drawerSymbol, setDrawerSymbol] = useState<string | null>(null);

  // View mode
  const [viewMode, setViewMode] = useState<"list" | "candlestick" | "area">("list");
  const [globalTimeRange, setGlobalTimeRange] = useState<TimeRange>("1Y");

  // Money location editing
  const [editingLocations, setEditingLocations] = useState(false);
  const [localLocations, setLocalLocations] = useState<MoneyLocation[]>([]);

  const campaignId = params.id as string;
  const notificationThresholdType = Form.useWatch("thresholdType", notificationForm) || "price";

  // Fetch campaign
  useEffect(() => {
    const found = state.campaigns.find((c) => c._id === campaignId);
    if (found) {
      setCampaign(found);
      setLocalLocations(found.moneyLocations);
      setLoading(false);
    } else if (!state.loading) {
      // Fetch from API
      fetch(`/api/campaigns/${campaignId}`)
        .then((r) => r.json())
        .then((data) => {
          if (data._id) {
            setCampaign(data);
            setLocalLocations(data.moneyLocations);
          }
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [campaignId, state.campaigns, state.loading]);

  const symbols = useMemo(() => {
    return campaign?.stocks.map((s) => s.symbol) || [];
  }, [campaign]);

  const { quotes } = useStockQuotes(symbols);

  const saveStockNotifications = useCallback(
    async (stockId: string, notifications: StockNotification[]) => {
      if (!campaign) return false;

      const updatedStocks = campaign.stocks.map((stock) => (stock._id === stockId ? { ...stock, notifications } : stock));

      setSavingNotification(true);
      try {
        const res = await fetch(`/api/campaigns/${campaign._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stocks: updatedStocks }),
        });

        if (res.ok) {
          const updated = await res.json();
          dispatch({ type: "UPDATE_CAMPAIGN", payload: updated });
          setCampaign(updated);
          setNotificationStock(updated.stocks.find((stock: CampaignStock) => stock._id === stockId) || null);
          return true;
        }

        message.error("Unable to save notification");
        return false;
      } catch (e) {
        console.error("Save notifications error:", e);
        message.error("Unable to save notification");
        return false;
      } finally {
        setSavingNotification(false);
      }
    },
    [campaign, dispatch],
  );

  const addStockNotification = useCallback(async () => {
    if (!notificationStock?._id) return;

    const values = await notificationForm.validateFields();
    const nextNotification: StockNotification = {
      type: values.direction,
      referencePrice: notificationStock.buyPrice,
      targetPrice: values.thresholdType === "price" ? values.targetValue : undefined,
      targetPercent: values.thresholdType === "percent" ? values.targetValue : undefined,
      createdAt: new Date().toISOString(),
    };

    const saved = await saveStockNotifications(notificationStock._id, [...(notificationStock.notifications || []), nextNotification]);
    if (saved) {
      notificationForm.resetFields();
      notificationForm.setFieldsValue({ thresholdType: "price", direction: "above" });
      message.success("Notification added");
    }
  }, [notificationForm, notificationStock, saveStockNotifications]);

  const deleteStockNotification = useCallback(
    async (index: number) => {
      if (!notificationStock?._id) return;

      const notifications = (notificationStock.notifications || []).filter((_, notificationIndex) => notificationIndex !== index);
      const saved = await saveStockNotifications(notificationStock._id, notifications);
      if (saved) message.success("Notification removed");
    },
    [notificationStock, saveStockNotifications],
  );

  // Save money locations
  const saveLocations = useCallback(async () => {
    if (!campaign) return;
    try {
      const res = await fetch(`/api/campaigns/${campaign._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moneyLocations: localLocations }),
      });
      if (res.ok) {
        const updated = await res.json();
        dispatch({ type: "UPDATE_CAMPAIGN", payload: updated });
        setCampaign(updated);
        setEditingLocations(false);
        message.success("Money locations updated");
      }
    } catch (e) {
      console.error("Save locations error:", e);
    }
  }, [campaign, localLocations, dispatch]);

  // Delete stock
  const deleteStock = useCallback(
    async (stockId: string) => {
      if (!campaign) return;
      const updatedStocks = campaign.stocks.filter((s) => s._id !== stockId);
      try {
        const res = await fetch(`/api/campaigns/${campaign._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stocks: updatedStocks }),
        });
        if (res.ok) {
          const updated = await res.json();
          dispatch({ type: "UPDATE_CAMPAIGN", payload: updated });
          setCampaign(updated);
          message.success("Stock removed");
        }
      } catch (e) {
        console.error("Delete stock error:", e);
      }
    },
    [campaign, dispatch],
  );

  const toggleStockStarred = useCallback(
    async (stockId: string) => {
      if (!campaign) return;

      const stockToToggle = campaign.stocks.find((stock) => stock._id === stockId);
      if (!stockToToggle) return;

      const nextIsStarred = !stockToToggle.isStarred;
      const updatedStocks = campaign.stocks.map((stock) => (stock._id === stockId ? { ...stock, isStarred: nextIsStarred } : stock));

      try {
        const res = await fetch(`/api/campaigns/${campaign._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stocks: updatedStocks }),
        });

        if (res.ok) {
          const updated = await res.json();
          dispatch({ type: "UPDATE_CAMPAIGN", payload: updated });
          setCampaign(updated);
          message.success(nextIsStarred ? "Position starred" : "Position unstarred");
          return;
        }

        message.error("Unable to update star");
      } catch (e) {
        console.error("Toggle stock star error:", e);
        message.error("Unable to update star");
      }
    },
    [campaign, dispatch],
  );

  // Calculate campaign stats
  const stats = useMemo(() => {
    return campaign ? calculateCampaignStats(campaign, quotes) : { invested: 0, currentValue: 0, realized: 0, pnl: 0, pnlPercent: 0 };
  }, [campaign, quotes]);

  const lastDayStats = useMemo<{ value: number; percentageBasis: number }>(() => {
    if (!campaign) return { value: 0, percentageBasis: 0 };

    return campaign.stocks.reduce(
      (totals, stock) => {
        const quote = quotes[stock.symbol];
        const movement = getLastDayMovement(stock, quote);
        if (!movement) return totals;

        const remainingShares = getRemainingShares(stock);
        const previousValue = isFiniteNumber(quote?.previousClose) ? remainingShares * quote.previousClose : 0;

        return {
          value: totals.value + movement.value,
          percentageBasis: totals.percentageBasis + previousValue,
        };
      },
      { value: 0, percentageBasis: 0 },
    );
  }, [campaign, quotes]);

  const lastDayMovement = {
    value: lastDayStats.value,
    percentage: lastDayStats.percentageBasis > 0 ? (lastDayStats.value / lastDayStats.percentageBasis) * 100 : 0,
  };

  const locationBalances = useMemo<Record<string, LocationBalance>>(() => {
    if (!campaign) return {};

    const balances: Record<string, LocationBalance> = {};

    campaign.moneyLocations.forEach((location) => {
      if (!location._id) return;
      balances[location._id] = {
        bought: 0,
        sold: 0,
        costBasis: 0,
        currentValue: 0,
        remaining: location.allocatedAmount,
        stockCount: 0,
      };
    });

    campaign.stocks.forEach((stock) => {
      if (!stock.locationId || !balances[stock.locationId]) return;

      const bought = stock.shares * stock.buyPrice;
      const sold = stock.transactions.reduce((sum, transaction) => sum + transaction.shares * transaction.price, 0);
      const soldShares = stock.transactions.reduce((sum, transaction) => sum + transaction.shares, 0);
      const remainingShares = stock.shares - soldShares;
      const currentPrice = quotes[stock.symbol]?.currentPrice ?? stock.buyPrice;

      balances[stock.locationId].bought += bought;
      balances[stock.locationId].sold += sold;
      balances[stock.locationId].costBasis += remainingShares * stock.buyPrice;
      balances[stock.locationId].currentValue += remainingShares * currentPrice;
      balances[stock.locationId].stockCount += remainingShares > 0 ? 1 : 0;
    });

    campaign.moneyLocations.forEach((location) => {
      if (!location._id || !balances[location._id]) return;
      balances[location._id].remaining = location.allocatedAmount - balances[location._id].bought + balances[location._id].sold;
    });

    return balances;
  }, [campaign, quotes]);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="page-container">
        <Empty description="Campaign not found" />
        <Button onClick={() => router.push("/campaigns")} icon={<ArrowLeftOutlined />} style={{ marginTop: 16 }}>
          Back to Campaigns
        </Button>
      </div>
    );
  }

  const activeStocks = sortStarredFirst(campaign.stocks.filter((stock) => !isSoldOut(stock)));
  const soldStocks = sortStarredFirst(campaign.stocks.filter(isSoldOut));
  const activeStockRows = activeStocks.map((stock) => ({ ...stock, key: stock._id }));
  const soldStockRows = soldStocks.map((stock) => ({ ...stock, key: stock._id }));

  const stockColumns = [
    {
      title: "Symbol",
      dataIndex: "symbol",
      key: "symbol",
      render: (symbol: string, record: CampaignStock) => {
        const soldOut = isSoldOut(record);
        const starred = Boolean(record.isStarred);

        return (
          <Space size={6}>
            <Button
              type="text"
              size="small"
              icon={starred ? <StarFilled /> : <StarOutlined />}
              className="stock-star-btn"
              style={{ color: starred ? "#f59e0b" : "#64748b" }}
              title={starred ? "Unstar position" : "Star position"}
              onClick={(e) => {
                e.stopPropagation();
                if (record._id) toggleStockStarred(record._id);
              }}
            />
            <Button
              type="link"
              style={{
                fontWeight: 700,
                fontSize: 15,
                padding: 0,
                color:
                  soldOut ? "#fca5a5"
                  : starred ? "#fbbf24"
                  : undefined,
              }}
              onClick={(e) => {
                e.stopPropagation();
                setDrawerSymbol(symbol);
              }}>
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
      render: (_: unknown, record: CampaignStock) => {
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
      render: (_: unknown, record: CampaignStock) => {
        const price = quotes[record.symbol]?.currentPrice;
        return price ? `$${price.toFixed(2)}` : "—";
      },
      align: "right" as const,
    },
    {
      title: "Last Day",
      key: "lastDay",
      render: (_: unknown, record: CampaignStock) => {
        const movement = getDisplayLastDayMovement(record, quotes[record.symbol]);
        return movement ? <PnLDisplay value={movement.value} percentage={movement.percentage} size="small" /> : <span style={{ color: "#64748b" }}>—</span>;
      },
      align: "right" as const,
    },
    {
      title: "In Stocks",
      key: "currentValue",
      render: (_: unknown, record: CampaignStock) => {
        const remaining = getRemainingShares(record);
        const currentPrice = quotes[record.symbol]?.currentPrice ?? record.buyPrice;
        const currentValue = remaining * currentPrice;

        return `$${currentValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      },
      align: "right" as const,
    },
    {
      title: "Unrealized P&L",
      key: "unrealized",
      render: (_: unknown, record: CampaignStock) => {
        const remaining = getRemainingShares(record);
        if (remaining <= 0) return <span style={{ color: "#fca5a5" }}>Sold</span>;

        const curPrice = quotes[record.symbol]?.currentPrice || record.buyPrice;
        const pnl = remaining * (curPrice - record.buyPrice);
        const pnlPct = ((curPrice - record.buyPrice) / record.buyPrice) * 100;
        return <PnLDisplay value={pnl} percentage={pnlPct} size="small" />;
      },
      align: "right" as const,
    },
    {
      title: "Realized",
      key: "realized",
      render: (_: unknown, record: CampaignStock) => {
        const realized = record.transactions.reduce((sum, t) => sum + t.shares * (t.price - record.buyPrice), 0);
        return realized !== 0 ? <PnLDisplay value={realized} size="small" /> : <span style={{ color: "#64748b" }}>—</span>;
      },
      align: "right" as const,
    },
    {
      title: "Funding",
      key: "location",
      render: (_: unknown, record: CampaignStock) => {
        const loc = campaign.moneyLocations.find((l) => l._id === record.locationId);
        if (!loc) return <span style={{ color: "#64748b" }}>—</span>;

        const balance = loc._id ? locationBalances[loc._id] : undefined;
        const purchaseAmount = record.shares * record.buyPrice;

        return (
          <div>
            <Tag>{loc.name}</Tag>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{formatCurrency(purchaseAmount)} bought</div>
            {balance && (
              <div style={{ fontSize: 12, color: balance.remaining >= 0 ? "#00d4aa" : "#ef4444" }}>
                {formatCurrency(balance.remaining)} left
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: "Actions",
      key: "actions",
      render: (_: unknown, record: CampaignStock) => {
        const hasRemaining = getRemainingShares(record) > 0;
        return (
          <Space size="small">
            {hasRemaining && (
              <Button
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  setSellStock(record);
                }}>
                Sell
              </Button>
            )}
            <Button
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setBuyMoreStock(record);
              }}>
              Buy More
            </Button>
            <Button
              size="small"
              type="text"
              onClick={(e) => {
                e.stopPropagation();
                setEditStock(record);
              }}>
              Edit
            </Button>
            <Popconfirm
              title="Remove this stock?"
              onConfirm={(e) => {
                e?.stopPropagation();
                deleteStock(record._id!);
              }}
              onCancel={(e) => e?.stopPropagation()}>
              <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
            </Popconfirm>
          </Space>
        );
      },
      width: 220,
    },
  ];

  const getStockRowClassName = (record: CampaignStock) => {
    if (isSoldOut(record)) return "campaign-stock-row-sold";
    return record.isStarred ? "campaign-stock-row-starred" : "";
  };

  const stockExpandable = {
    expandedRowRender: (record: CampaignStock) => (
      <div style={{ padding: "8px 0" }}>
        <Divider titlePlacement="start" style={{ color: "#64748b", fontSize: 12, margin: "0 0 12px 0" }}>
          Transaction History
        </Divider>
        {record.transactions.length === 0 ?
          <span style={{ color: "#64748b", fontSize: 13 }}>No transactions yet</span>
        : <Table
            dataSource={record.transactions.map((t, i) => ({ ...t, key: i }))}
            columns={[
              { title: "Date", dataIndex: "date", render: (d: string) => new Date(d).toLocaleDateString() },
              { title: "Shares Sold", dataIndex: "shares", render: (v: number) => v.toLocaleString() },
              { title: "Sell Price", dataIndex: "price", render: (v: number) => `$${v.toFixed(2)}` },
              { title: "% Sold", dataIndex: "percentSold", render: (v: number) => `${v}%` },
              {
                title: "Realized P&L",
                key: "pnl",
                render: (_: unknown, t: { shares: number; price: number }) => {
                  const pnl = t.shares * (t.price - record.buyPrice);
                  return <PnLDisplay value={pnl} size="small" />;
                },
              },
              {
                title: "Actions",
                key: "actions",
                render: (_: unknown, transactionRecord: any) => (
                  <Button
                    size="small"
                    type="text"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditTransaction({ stock: record, transaction: transactionRecord });
                    }}>
                    Edit
                  </Button>
                ),
                align: "right" as const,
              },
            ]}
            pagination={false}
            size="small"
            scroll={{ x: 640 }}
          />
        }
      </div>
    ),
  };

  const renderMobileStockCards = (stocks: CampaignStock[]) => (
    <div className="mobile-stock-list">
      {stocks.map((stock) => {
        const soldOut = isSoldOut(stock);
        const starred = Boolean(stock.isStarred);
        const sold = getSoldShares(stock);
        const remaining = getRemainingShares(stock);
        const currentPrice = quotes[stock.symbol]?.currentPrice ?? stock.buyPrice;
        const currentValue = remaining * currentPrice;
        const unrealized = remaining * (currentPrice - stock.buyPrice);
        const unrealizedPct = ((currentPrice - stock.buyPrice) / stock.buyPrice) * 100;
        const lastDayMovement = getDisplayLastDayMovement(stock, quotes[stock.symbol]);
        const realized = stock.transactions.reduce(
          (sum, transaction) => sum + transaction.shares * (transaction.price - stock.buyPrice),
          0,
        );
        const loc = campaign.moneyLocations.find((location) => location._id === stock.locationId);
        const balance = loc?._id ? locationBalances[loc._id] : undefined;
        const notifications = stock.notifications || [];

        return (
          <div
            key={stock._id}
            className={`mobile-stock-card ${soldOut ? "mobile-stock-card-sold" : ""} ${starred ? "mobile-stock-card-starred" : ""}`}>
            <div className="mobile-stock-card-header">
              <div className="mobile-stock-title">
                <Button
                  type="text"
                  size="small"
                  icon={starred ? <StarFilled /> : <StarOutlined />}
                  className="stock-star-btn"
                  style={{ color: starred ? "#f59e0b" : "#64748b" }}
                  title={starred ? "Unstar position" : "Star position"}
                  onClick={() => {
                    if (stock._id) toggleStockStarred(stock._id);
                  }}
                />
                <Button
                  type="link"
                  className="mobile-stock-symbol"
                  style={{
                    color:
                      soldOut ? "#fca5a5"
                      : starred ? "#fbbf24"
                      : undefined,
                  }}
                  onClick={() => setDrawerSymbol(stock.symbol)}>
                  {stock.symbol} <LineChartOutlined style={{ fontSize: 11 }} />
                </Button>
              </div>
              <div className="mobile-stock-tags">
                {starred && <Tag color="gold">Starred</Tag>}
                {soldOut && <Tag color="red">Sold</Tag>}
                {notifications.length > 0 && (
                  <Tag color="gold">
                    {notifications.length} alert{notifications.length === 1 ? "" : "s"}
                  </Tag>
                )}
              </div>
            </div>

            <div className="mobile-stock-metrics">
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
                <strong>{formatCurrency(currentPrice)}</strong>
              </div>
              <div>
                <span>Last Day</span>
                {lastDayMovement ?
                  <PnLDisplay value={lastDayMovement.value} percentage={lastDayMovement.percentage} size="small" />
                : <strong className="neutral">-</strong>}
              </div>
              <div>
                <span>In Stocks</span>
                <strong>{formatCurrency(currentValue)}</strong>
              </div>
              <div>
                <span>Unrealized</span>
                {remaining <= 0 ?
                  <strong className="loss">Sold</strong>
                : <PnLDisplay value={unrealized} percentage={unrealizedPct} size="small" />}
              </div>
              <div>
                <span>Realized</span>
                {realized !== 0 ?
                  <PnLDisplay value={realized} size="small" />
                : <strong className="neutral">-</strong>}
              </div>
            </div>

            {loc && (
              <div className="mobile-stock-funding">
                <Tag>{loc.name}</Tag>
                <span>{formatCurrency(stock.shares * stock.buyPrice)} bought</span>
                {balance && (
                  <strong style={{ color: balance.remaining >= 0 ? "#00d4aa" : "#ef4444" }}>
                    {formatCurrency(balance.remaining)} left
                  </strong>
                )}
              </div>
            )}

            {stock.transactions.length > 0 && (
              <div className="mobile-transaction-list">
                <div className="mobile-transaction-title">Transaction History</div>
                {stock.transactions.map((transaction, index) => (
                  <div key={`${transaction.date}-${index}`} className="mobile-transaction-row">
                    <div>
                      <strong>{new Date(transaction.date).toLocaleDateString()}</strong>
                      <span>
                        {transaction.shares.toLocaleString()} shares at {formatCurrency(transaction.price)}
                      </span>
                    </div>
                    <Button
                      size="small"
                      type="text"
                      onClick={() => setEditTransaction({ stock, transaction: { ...transaction, key: index } })}>
                      Edit
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="mobile-stock-actions">
              <Button
                size="small"
                icon={<BellOutlined />}
                type={notifications.length > 0 ? "primary" : "default"}
                onClick={() => {
                  setNotificationStock(stock);
                  notificationForm.setFieldsValue({ thresholdType: "price", direction: "above" });
                }}>
                Alerts
              </Button>
              {!soldOut && (
                <Button size="small" onClick={() => setSellStock(stock)}>
                  Sell
                </Button>
              )}
              <Button size="small" onClick={() => setBuyMoreStock(stock)}>
                Buy More
              </Button>
              <Button size="small" onClick={() => setEditStock(stock)}>
                Edit
              </Button>
              <Popconfirm title="Remove this stock?" onConfirm={() => deleteStock(stock._id!)}>
                <Button size="small" danger icon={<DeleteOutlined />}>
                  Remove
                </Button>
              </Popconfirm>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div className="campaign-page-heading">
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push("/campaigns")} type="text" />
          <h1>{campaign.name}</h1>
        </div>
        <Button type="primary" icon={<PlusOutlined />} className="page-primary-action" onClick={() => setAddStockModal(true)}>
          Add Stock
        </Button>
      </div>

      {/* Stats Row */}
      <div className="stats-grid animate-in">
        <Card className="stat-card" bordered={false}>
          <Statistic
            title={<span style={{ color: "#64748b" }}>Invested</span>}
            value={stats.invested}
            prefix={<DollarOutlined style={{ color: "#3b82f6" }} />}
            precision={2}
            valueStyle={{ color: "#e2e8f0" }}
            formatter={(v) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
          />
        </Card>
        <Card className="stat-card" bordered={false}>
          <Statistic
            title={<span style={{ color: "#64748b" }}>Total in Stocks</span>}
            value={stats.currentValue}
            precision={2}
            valueStyle={{ color: "#e2e8f0" }}
            formatter={(v) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
          />
        </Card>
        <Card className="stat-card" bordered={false}>
          <div style={{ color: "#64748b", fontSize: 14, marginBottom: 8 }}>Last Day</div>
          <PnLDisplay value={lastDayMovement.value} percentage={lastDayMovement.percentage} size="large" />
        </Card>
        <Card className="stat-card" bordered={false}>
          <Statistic
            title={<span style={{ color: "#64748b" }}>Total P&L</span>}
            prefix={stats.pnl >= 0 ? <RiseOutlined /> : <FallOutlined />}
            value={stats.pnl}
            precision={2}
            valueStyle={{ color: stats.pnl >= 0 ? "#22c55e" : "#ef4444" }}
            formatter={(v) => `${Number(v) >= 0 ? "+" : ""}$${Math.abs(Number(v)).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
          />
        </Card>
        <Card className="stat-card" bordered={false}>
          <Statistic
            title={<span style={{ color: "#64748b" }}>Realized Gains</span>}
            prefix={<TrophyOutlined style={{ color: "#f59e0b" }} />}
            value={stats.realized}
            precision={2}
            valueStyle={{ color: stats.realized >= 0 ? "#22c55e" : "#ef4444" }}
            formatter={(v) => `${Number(v) >= 0 ? "+" : ""}$${Math.abs(Number(v)).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
          />
        </Card>
      </div>

      {/* Money Locations */}
      <Card
        className="campaign-detail-card money-locations-card"
        title={
          <span style={{ color: "#e2e8f0", display: "flex", alignItems: "center", gap: 8 }}>
            <BankOutlined /> Money Locations
          </span>
        }
        bordered={false}
        style={{ marginBottom: 24 }}
        extra={
          editingLocations ?
            <Space className="money-location-edit-actions">
              <Button
                onClick={() => {
                  setLocalLocations(campaign.moneyLocations);
                  setEditingLocations(false);
                }}>
                Cancel
              </Button>
              <Button type="primary" onClick={saveLocations}>
                Save
              </Button>
            </Space>
          : <Button type="text" onClick={() => setEditingLocations(true)}>
              Edit
            </Button>
        }>
        {editingLocations ?
          <div>
            {localLocations.map((loc, i) => (
              <div
                key={loc._id || i}
                className="money-location-edit-row"
                style={{
                  display: "flex",
                  gap: 8,
                  marginBottom: 10,
                  padding: 10,
                  background: "#0f1629",
                  borderRadius: 8,
                  border: "1px solid #1e2a3a",
                }}>
                <Input
                  value={loc.name}
                  onChange={(e) => {
                    const updated = [...localLocations];
                    updated[i] = { ...updated[i], name: e.target.value };
                    setLocalLocations(updated);
                  }}
                  placeholder="Name"
                  style={{ flex: 2, minWidth: 0 }}
                />
                <Select
                  value={loc.type}
                  onChange={(v) => {
                    const updated = [...localLocations];
                    updated[i] = { ...updated[i], type: v as MoneyLocation["type"] };
                    setLocalLocations(updated);
                  }}
                  style={{ flex: 1, minWidth: 0 }}
                  options={[
                    { label: "PayPal", value: "PayPal" },
                    { label: "Kraken", value: "Kraken" },
                    { label: "Fidelity Roth Clara", value: "Fidelity Roth Clara" },
                    { label: "Fidelity Roth Dan", value: "Fidelity Roth Dan" },
                    { label: "Fidelity Dan", value: "Fidelity Dan" },
                    { label: "Charles Schwab", value: "Charles Schwab" },
                  ]}
                />
                <InputNumber
                  value={loc.allocatedAmount}
                  onChange={(v) => {
                    const updated = [...localLocations];
                    updated[i] = { ...updated[i], allocatedAmount: v || 0 };
                    setLocalLocations(updated);
                  }}
                  prefix="$"
                  style={{ flex: 1, minWidth: 0 }}
                  min={0}
                />
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => setLocalLocations(localLocations.filter((_, j) => j !== i))}
                />
              </div>
            ))}
            <Button
              type="dashed"
              onClick={() => setLocalLocations([...localLocations, { name: "", type: "Fidelity Dan", allocatedAmount: 0 }])}
              icon={<PlusOutlined />}
              block>
              Add Location
            </Button>
          </div>
        : campaign.moneyLocations.length === 0 ?
          <Empty
            description={<span style={{ color: "#64748b" }}>No money locations. Click Edit to add.</span>}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        : <Row gutter={16}>
            {campaign.moneyLocations.map((loc) => {
              const balance = loc._id ? locationBalances[loc._id] : undefined;
              const used = balance ? loc.allocatedAmount - balance.remaining : 0;
              const usedPercent = loc.allocatedAmount > 0 ? Math.min(Math.max((used / loc.allocatedAmount) * 100, 0), 100) : 0;

              return (
                <Col key={loc._id} xs={24} md={12} lg={8}>
                  <Card size="small" style={{ background: "#0f1629", border: "1px solid #1e2a3a", marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
                      <div>
                        <div style={{ fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>{loc.name}</div>
                        <Tag color="default">{loc.type}</Tag>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>Left to buy</div>
                        <div
                          style={{
                            fontSize: 18,
                            fontWeight: 800,
                            color: (balance?.remaining ?? loc.allocatedAmount) >= 0 ? "#00d4aa" : "#ef4444",
                          }}>
                          {formatCurrency(balance?.remaining ?? loc.allocatedAmount)}
                        </div>
                      </div>
                    </div>

                    <Progress
                      percent={usedPercent}
                      showInfo={false}
                      strokeColor={used > loc.allocatedAmount ? "#ef4444" : "#00d4aa"}
                      trailColor="#1e2a3a"
                      style={{ marginBottom: 8 }}
                    />

                    <Row gutter={12}>
                      <Col span={8}>
                        <div style={{ fontSize: 11, color: "#64748b" }}>Allocated</div>
                        <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{formatCurrency(loc.allocatedAmount)}</div>
                      </Col>
                      <Col span={8}>
                        <div style={{ fontSize: 11, color: "#64748b" }}>Bought</div>
                        <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{formatCurrency(balance?.bought ?? 0)}</div>
                      </Col>
                      <Col span={8}>
                        <div style={{ fontSize: 11, color: "#64748b" }}>In Stocks</div>
                        <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{formatCurrency(balance?.currentValue ?? 0)}</div>
                      </Col>
                    </Row>
                  </Card>
                </Col>
              );
            })}
          </Row>
        }
      </Card>

      {/* Stocks Area */}
      <Card
        className="campaign-detail-card campaign-stocks-card"
        title={
          <div className="stocks-card-title">
            <span className="stocks-card-heading">
              Stocks
              {campaign.stocks.length > 0 && viewMode !== "list" && (
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
            <Space className="stocks-card-actions">
              <Segmented
                options={[
                  { value: "list", icon: <UnorderedListOutlined /> },
                  { value: "candlestick", icon: <AppstoreOutlined /> },
                  { value: "area", icon: <LineChartOutlined /> },
                ]}
                value={viewMode}
                onChange={(v) => setViewMode(v as "list" | "candlestick" | "area")}
              />
              <Button type="primary" icon={<PlusOutlined />} className="stocks-add-btn" onClick={() => setAddStockModal(true)}>
                Add Stock
              </Button>
            </Space>
          </div>
        }
        bordered={false}>
        {campaign.stocks.length === 0 ?
          <Empty
            description={<span style={{ color: "#64748b" }}>No stocks in this campaign yet.</span>}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        : viewMode === "list" ?
          <>
            {activeStockRows.length > 0 && (
              <>
                <div className="desktop-stock-table">
                  <Table
                    dataSource={activeStockRows}
                    columns={stockColumns}
                    pagination={false}
                    expandable={stockExpandable}
                    rowClassName={getStockRowClassName}
                    scroll={{ x: 1220 }}
                  />
                </div>
                <div className="mobile-stock-cards">{renderMobileStockCards(activeStocks)}</div>
              </>
            )}

            {soldStockRows.length > 0 && (
              <div style={{ marginTop: activeStockRows.length > 0 ? 28 : 0 }}>
                <Divider titlePlacement="start" style={{ color: "#fca5a5", margin: "0 0 16px" }}>
                  Sold Positions
                </Divider>
                <div
                  style={{
                    background: "rgba(127, 29, 29, 0.16)",
                    border: "1px solid rgba(248, 113, 113, 0.35)",
                    borderRadius: 12,
                    padding: 12,
                  }}>
                  <div style={{ color: "#fca5a5", fontSize: 13, marginBottom: 12 }}>
                    These companies are fully sold and kept here for realized P&L and transaction history.
                  </div>
                  <div className="desktop-stock-table">
                    <Table
                      dataSource={soldStockRows}
                      columns={stockColumns}
                      pagination={false}
                      expandable={stockExpandable}
                      rowClassName={getStockRowClassName}
                      scroll={{ x: 1220 }}
                    />
                  </div>
                  <div className="mobile-stock-cards">{renderMobileStockCards(soldStocks)}</div>
                </div>
              </div>
            )}
          </>
        : <Row gutter={[24, 24]}>
            {[...activeStocks, ...soldStocks].map((stock, index) => {
              const markers: import("lightweight-charts").SeriesMarker<import("lightweight-charts").Time>[] = [];
              const notifications = stock.notifications || [];
              const soldOut = isSoldOut(stock);
              const starred = Boolean(stock.isStarred);
              const alertRules: ChartAlertRule[] = notifications.map((notification) => ({
                id: notification._id,
                type: notification.type,
                targetPrice: notification.targetPrice,
                targetPercent: notification.targetPercent,
                referencePrice: notification.referencePrice,
                createdAt: notification.createdAt,
              }));
              const currentPrice = quotes[stock.symbol]?.currentPrice;
              const triggeredCount =
                currentPrice == null ? 0 : (
                  notifications.filter((notification) => {
                    const targetPrice = getNotificationTargetPrice(notification);
                    if (targetPrice == null) return false;
                    return notification.type === "above" ? currentPrice >= targetPrice : currentPrice <= targetPrice;
                  }).length
                );

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

              if (stock.transactions && stock.transactions.length > 0) {
                stock.transactions.forEach((t) => {
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
              }

              return (
                <React.Fragment key={stock._id}>
                  {index === activeStocks.length && soldStocks.length > 0 && (
                    <Col span={24}>
                      <Divider titlePlacement="start" style={{ color: "#fca5a5", margin: "4px 0 -4px" }}>
                        Sold Positions
                      </Divider>
                    </Col>
                  )}
                  <Col xs={24} lg={12}>
                    <div
                      className={`chart-stock-card ${soldOut ? "chart-stock-card-sold" : ""} ${starred ? "chart-stock-card-starred" : ""}`}
                      style={{
                        background:
                          soldOut ? "rgba(127, 29, 29, 0.14)"
                          : starred ? "rgba(120, 53, 15, 0.18)"
                          : "#0f1629",
                        borderRadius: 12,
                        border:
                          soldOut ? "1px solid rgba(248, 113, 113, 0.35)"
                          : starred ? "1px solid rgba(245, 158, 11, 0.42)"
                          : "1px solid #1e2a3a",
                        overflow: "hidden",
                      }}>
                      <div
                        className="chart-stock-card-header"
                        style={{
                          padding: "12px 16px",
                          borderBottom:
                            soldOut ? "1px solid rgba(248, 113, 113, 0.28)"
                            : starred ? "1px solid rgba(245, 158, 11, 0.28)"
                            : "1px solid #1e2a3a",
                          display: "flex",
                          justifyContent: "space-between",
                        }}>
                        <Space size="small" className="chart-stock-title">
                          <Button
                            type="text"
                            size="small"
                            icon={starred ? <StarFilled /> : <StarOutlined />}
                            style={{ color: starred ? "#f59e0b" : "#64748b" }}
                            title={starred ? "Unstar position" : "Star position"}
                            onClick={() => {
                              if (stock._id) toggleStockStarred(stock._id);
                            }}
                          />
                          <span style={{ fontWeight: 700, fontSize: 16, color: "#e2e8f0" }}>{stock.symbol}</span>
                          {soldOut && <Tag color="red">Sold</Tag>}
                          {notifications.length > 0 && (
                            <Tag color={triggeredCount > 0 ? "red" : "gold"}>
                              {triggeredCount > 0 ?
                                `${triggeredCount} hit`
                              : `${notifications.length} alert${notifications.length === 1 ? "" : "s"}`}
                            </Tag>
                          )}
                        </Space>
                        <Space size="small" className="chart-stock-actions">
                          <Button
                            size="small"
                            type={notifications.length > 0 ? "primary" : "text"}
                            icon={<BellOutlined />}
                            onClick={() => {
                              setNotificationStock(stock);
                              notificationForm.setFieldsValue({ thresholdType: "price", direction: "above" });
                            }}>
                            Alerts
                          </Button>
                          <Button size="small" type="text" onClick={() => setBuyMoreStock(stock)}>
                            Buy More
                          </Button>
                          <Button size="small" type="text" onClick={() => setEditStock(stock)}>
                            Edit
                          </Button>
                          {!soldOut && (
                            <Button size="small" type="text" onClick={() => setSellStock(stock)}>
                              Sell
                            </Button>
                          )}
                        </Space>
                      </div>
                      <StockChart
                        symbol={stock.symbol}
                        height={220}
                        hideToolbar
                        activeRangeOverride={globalTimeRange}
                        chartType={viewMode === "area" ? "area" : "candlestick"}
                        markers={markers}
                        alertRules={alertRules}
                      />
                    </div>
                  </Col>
                </React.Fragment>
              );
            })}
          </Row>
        }
      </Card>

      {/* Modals & Drawer */}
      <AddStockModal
        open={addStockModal || !!buyMoreStock}
        onClose={() => {
          setAddStockModal(false);
          setBuyMoreStock(null);
        }}
        campaign={campaign}
        stock={buyMoreStock}
      />
      <SellStockModal open={!!sellStock} onClose={() => setSellStock(null)} campaign={campaign} stock={sellStock} />
      <EditStockModal
        open={!!editStock}
        onClose={() => setEditStock(null)}
        campaign={campaign}
        stock={editStock}
        onEditTransaction={(s, t) => {
          setEditStock(null);
          setEditTransaction({ stock: s, transaction: t });
        }}
      />
      <EditTransactionModal
        open={!!editTransaction}
        onClose={() => setEditTransaction(null)}
        campaign={campaign}
        stock={editTransaction?.stock || null}
        transaction={editTransaction?.transaction || null}
      />
      <Modal
        title={<span style={{ fontSize: 18, fontWeight: 600 }}>{notificationStock?.symbol} Chart Alerts</span>}
        open={!!notificationStock}
        onCancel={() => {
          setNotificationStock(null);
          notificationForm.resetFields();
        }}
        footer={null}
        width={540}
        className="chart-alert-modal"
        destroyOnClose>
        {notificationStock && (
          <div style={{ marginTop: 16 }}>
            <Typography.Text type="secondary">
              Percentage alerts use the buy price as the reference: {formatCurrency(notificationStock.buyPrice)}.
            </Typography.Text>

            <Form
              form={notificationForm}
              layout="vertical"
              initialValues={{ thresholdType: "price", direction: "above" }}
              style={{ marginTop: 16 }}>
              <Form.Item name="direction" label="Highlight when price...">
                <Radio.Group>
                  <Radio.Button value="above">Goes Above</Radio.Button>
                  <Radio.Button value="below">Drops Below</Radio.Button>
                </Radio.Group>
              </Form.Item>

              <Form.Item name="thresholdType" label="Target Type">
                <Radio.Group>
                  <Radio value="price">Fixed Price ($)</Radio>
                  <Radio value="percent">Percentage from Buy Price (%)</Radio>
                </Radio.Group>
              </Form.Item>

              <Form.Item name="targetValue" label="Value" rules={[{ required: true, message: "Enter a target value" }]}>
                <InputNumber
                  prefix={notificationThresholdType === "price" ? "$" : undefined}
                  suffix={notificationThresholdType === "percent" ? "%" : undefined}
                  style={{ width: "100%" }}
                  size="large"
                  min={0.01}
                  step={notificationThresholdType === "price" ? 0.01 : 0.1}
                />
              </Form.Item>

              <Button type="primary" icon={<BellOutlined />} onClick={addStockNotification} loading={savingNotification} block>
                Add Chart Alert
              </Button>
            </Form>

            <Divider titlePlacement="start" style={{ margin: "24px 0 12px" }}>
              <span style={{ fontSize: 14, color: "#64748b" }}>Active alerts</span>
            </Divider>

            {(notificationStock.notifications || []).length === 0 ?
              <Empty
                description={<span style={{ color: "#64748b" }}>No chart alerts for this stock yet.</span>}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            : <List
                size="small"
                dataSource={notificationStock.notifications || []}
                renderItem={(notification, index) => {
                  const targetPrice = getNotificationTargetPrice(notification);
                  const currentPrice = quotes[notificationStock.symbol]?.currentPrice;
                  const isTriggered =
                    targetPrice != null && currentPrice != null ?
                      notification.type === "above" ?
                        currentPrice >= targetPrice
                      : currentPrice <= targetPrice
                    : false;

                  return (
                    <List.Item
                      actions={[
                        <Popconfirm key="delete" title="Delete alert?" onConfirm={() => deleteStockNotification(index)}>
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                        </Popconfirm>,
                      ]}>
                      <List.Item.Meta
                        title={
                          <Space>
                            <Typography.Text strong>{formatNotification(notification)}</Typography.Text>
                            {isTriggered && <Tag color="red">Hit</Tag>}
                          </Space>
                        }
                        description={`Target chart line: ${targetPrice ? formatCurrency(targetPrice) : "—"}`}
                      />
                    </List.Item>
                  );
                }}
                style={{ background: "#0f1629", borderRadius: 8, border: "1px solid #1e2a3a", padding: "0 8px" }}
              />
            }
          </div>
        )}
      </Modal>
      <StockDetailDrawer symbol={drawerSymbol} open={!!drawerSymbol} onClose={() => setDrawerSymbol(null)} />
    </div>
  );
}
