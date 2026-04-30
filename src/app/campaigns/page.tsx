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
import { Campaign } from "@/types";

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

        return {
          totalCurrentValue: totals.totalCurrentValue + stats.currentValue,
        };
      },
      { totalCurrentValue: 0 }
    );
  }, [state.campaigns, quotes]);

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
          </div>

          <Row gutter={[20, 20]}>
            {state.campaigns.map((campaign) => {
              const stats = calculateCampaignStats(campaign, quotes);

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
