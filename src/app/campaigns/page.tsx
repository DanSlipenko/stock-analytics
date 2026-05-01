"use client";

import React, { useState, useMemo } from "react";
import { Card, Button, Row, Col, Statistic, Spin, Popconfirm, message } from "antd";
import { PlusOutlined, DeleteOutlined, EditOutlined, FolderOutlined, RightOutlined, FundOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useStore } from "@/context/StoreContext";
import { useStockQuotes } from "@/hooks/useStockQuote";
import CreateCampaignModal from "@/components/campaigns/CreateCampaignModal";
import PnLDisplay from "@/components/shared/PnLDisplay";
import { calculateCampaignStats } from "@/lib/campaignStats";
import { Campaign, CampaignStock, StockQuote } from "@/types";

type DayChangeStats = {
  value: number;
  percentage: number;
  basis: number;
};

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const getSoldShares = (stock: CampaignStock) => stock.transactions.reduce((sum, transaction) => sum + transaction.shares, 0);

const getRemainingShares = (stock: CampaignStock) => Math.max(stock.shares - getSoldShares(stock), 0);

const getQuoteDayChange = (quote?: StockQuote) => {
  if (!quote) return null;

  const change =
    isFiniteNumber(quote.change) ? quote.change
    : isFiniteNumber(quote.currentPrice) && isFiniteNumber(quote.previousClose) ? quote.currentPrice - quote.previousClose
    : null;

  if (change == null) return null;

  return {
    change,
    previousClose: isFiniteNumber(quote.previousClose) ? quote.previousClose : null,
  };
};

const calculateCampaignDayChange = (campaign: Campaign, quotes: Record<string, StockQuote>): DayChangeStats => {
  const totals = campaign.stocks.reduce(
    (sum, stock) => {
      const remainingShares = getRemainingShares(stock);
      const quoteChange = getQuoteDayChange(quotes[stock.symbol]);
      if (remainingShares <= 0 || !quoteChange) return sum;

      return {
        value: sum.value + remainingShares * quoteChange.change,
        basis: sum.basis + (quoteChange.previousClose ? remainingShares * quoteChange.previousClose : 0),
      };
    },
    { value: 0, basis: 0 },
  );

  return {
    value: totals.value,
    basis: totals.basis,
    percentage: totals.basis > 0 ? (totals.value / totals.basis) * 100 : 0,
  };
};

export default function CampaignsPage() {
  const { state, dispatch } = useStore();
  const router = useRouter();
  const [createModal, setCreateModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);

  // Collect all symbols
  const allSymbols = useMemo(() => {
    const s = new Set<string>();
    state.campaigns.forEach((c) => c.stocks.forEach((st) => s.add(st.symbol)));
    return Array.from(s);
  }, [state.campaigns]);

  const { quotes } = useStockQuotes(allSymbols);

  const portfolioStats = useMemo(() => {
    return state.campaigns.reduce(
      (totals, campaign) => {
        const stats = calculateCampaignStats(campaign, quotes);
        const dayChange = calculateCampaignDayChange(campaign, quotes);

        return {
          totalCurrentValue: totals.totalCurrentValue + stats.currentValue,
          totalPnl: totals.totalPnl + stats.pnl,
          totalPnlBasis: totals.totalPnlBasis + stats.invested + Math.abs(stats.realized),
          dayChange: totals.dayChange + dayChange.value,
          dayChangeBasis: totals.dayChangeBasis + dayChange.basis,
        };
      },
      { totalCurrentValue: 0, totalPnl: 0, totalPnlBasis: 0, dayChange: 0, dayChangeBasis: 0 },
    );
  }, [state.campaigns, quotes]);

  const portfolioPnlPercent = portfolioStats.totalPnlBasis > 0 ? (portfolioStats.totalPnl / portfolioStats.totalPnlBasis) * 100 : 0;
  const portfolioDayChangePercent =
    portfolioStats.dayChangeBasis > 0 ? (portfolioStats.dayChange / portfolioStats.dayChangeBasis) * 100 : 0;

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
      if (res.ok) {
        dispatch({ type: "DELETE_CAMPAIGN", payload: id });
        message.success("Campaign deleted");
      }
    } catch (e) {
      console.error("Delete campaign error:", e);
    }
  };

  if (state.loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Campaigns</h1>
        <Button type="primary" icon={<PlusOutlined />} size="large" onClick={() => setCreateModal(true)}>
          New Campaign
        </Button>
      </div>

      {state.campaigns.length === 0 ?
        <div className="empty-state">
          <FolderOutlined className="empty-state-icon" />
          <p className="empty-state-text">No campaigns yet. Create your first campaign to start tracking stocks.</p>
          <Button type="primary" icon={<PlusOutlined />} size="large" onClick={() => setCreateModal(true)}>
            Create Campaign
          </Button>
        </div>
      : <>
          <div className="stats-grid animate-in">
            <Card className="stat-card" bordered={false}>
              <Statistic
                title={<span style={{ color: "#64748b" }}>Total in Stocks</span>}
                value={portfolioStats.totalCurrentValue}
                prefix={<FundOutlined style={{ color: "#00d4aa" }} />}
                precision={2}
                valueStyle={{ color: "#e2e8f0" }}
                formatter={(value) => `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
              />
            </Card>
            <Card className="stat-card" bordered={false}>
              <div style={{ color: "#64748b", fontSize: 14, marginBottom: 8 }}>Avg Day Change</div>
              <PnLDisplay value={portfolioStats.dayChange} percentage={portfolioDayChangePercent} size="large" />
            </Card>
            <Card className="stat-card" bordered={false}>
              <div style={{ color: "#64748b", fontSize: 14, marginBottom: 8 }}>Total P&L</div>
              <PnLDisplay value={portfolioStats.totalPnl} percentage={portfolioPnlPercent} size="large" />
            </Card>
          </div>

          <Row gutter={[20, 20]}>
            {state.campaigns.map((campaign) => {
              const stats = calculateCampaignStats(campaign, quotes);
              const dayChange = calculateCampaignDayChange(campaign, quotes);

              return (
                <Col xs={24} lg={12} xl={8} key={campaign._id}>
                  <Card
                    className="campaign-card"
                    hoverable
                    onClick={() => router.push(`/campaigns/${campaign._id}`)}
                    actions={[
                      <Button
                        key="edit"
                        type="text"
                        icon={<EditOutlined />}
                        className="campaign-action-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingCampaign(campaign);
                        }}
                        size="small">
                        Edit
                      </Button>,
                      <Popconfirm
                        key="delete"
                        title="Delete this campaign?"
                        description="All stocks and transactions will be removed."
                        onConfirm={(e) => {
                          e?.stopPropagation();
                          handleDelete(campaign._id!);
                        }}
                        onCancel={(e) => e?.stopPropagation()}
                        okText="Delete"
                        okType="danger">
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          className="campaign-action-btn"
                          onClick={(e) => e.stopPropagation()}
                          size="small">
                          Delete
                        </Button>
                      </Popconfirm>,
                      <Button key="view" type="text" icon={<RightOutlined />} className="campaign-action-btn" size="small">
                        View
                      </Button>,
                    ]}>
                    <div className="campaign-card-header">
                      <div className="campaign-card-title">{campaign.name}</div>
                      <div className="campaign-card-pills">
                        <span className="campaign-pill campaign-pill-accent">{campaign.stocks.length} stocks</span>
                        <span className="campaign-pill">{campaign.moneyLocations.length} locations</span>
                        {campaign.startDate && (
                          <span className="campaign-pill campaign-pill-muted">
                            Started {new Date(campaign.startDate).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="campaign-card-stats">
                      <div className="campaign-stat">
                        <Statistic
                          title={<span className="campaign-stat-label">Invested</span>}
                          value={stats.invested}
                          prefix="$"
                          precision={0}
                          valueStyle={{ fontSize: 16, color: "#e2e8f0", lineHeight: 1.15 }}
                        />
                      </div>
                      <div className="campaign-stat">
                        <Statistic
                          title={<span className="campaign-stat-label">In Stocks</span>}
                          value={stats.currentValue}
                          prefix="$"
                          precision={0}
                          valueStyle={{ fontSize: 16, color: "#e2e8f0", lineHeight: 1.15 }}
                        />
                      </div>
                      <div className="campaign-stat campaign-stat-pnl">
                        <div>
                          <div className="campaign-stat-label">P&L</div>
                          <PnLDisplay value={stats.pnl} percentage={stats.pnlPercent} size="small" />
                        </div>
                      </div>
                      <div className="campaign-stat campaign-stat-pnl">
                        <div>
                          <div className="campaign-stat-label">Day Change</div>
                          <PnLDisplay value={dayChange.value} percentage={dayChange.percentage} size="small" />
                        </div>
                      </div>
                    </div>
                  </Card>
                </Col>
              );
            })}
          </Row>
        </>
      }

      <CreateCampaignModal open={createModal} onClose={() => setCreateModal(false)} />
      <CreateCampaignModal open={Boolean(editingCampaign)} onClose={() => setEditingCampaign(null)} campaign={editingCampaign} />
    </div>
  );
}
