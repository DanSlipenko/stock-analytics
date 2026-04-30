"use client";

import React, { useState, useMemo } from "react";
import { Card, Button, Row, Col, Tag, Statistic, Empty, Spin, Popconfirm, message } from "antd";
import { PlusOutlined, DeleteOutlined, FolderOutlined, RightOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useStore } from "@/context/StoreContext";
import { useStockQuotes } from "@/hooks/useStockQuote";
import CreateCampaignModal from "@/components/campaigns/CreateCampaignModal";
import PnLDisplay from "@/components/shared/PnLDisplay";

export default function CampaignsPage() {
  const { state, dispatch } = useStore();
  const router = useRouter();
  const [createModal, setCreateModal] = useState(false);

  // Collect all symbols
  const allSymbols = useMemo(() => {
    const s = new Set<string>();
    state.campaigns.forEach((c) => c.stocks.forEach((st) => s.add(st.symbol)));
    return Array.from(s);
  }, [state.campaigns]);

  const { quotes } = useStockQuotes(allSymbols);

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
      : <Row gutter={[20, 20]}>
          {state.campaigns.map((campaign) => {
            let invested = 0;
            let currentVal = 0;
            let realized = 0;

            campaign.stocks.forEach((stock) => {
              const soldShares = stock.transactions.reduce((sum, t) => sum + t.shares, 0);
              const remaining = stock.shares - soldShares;
              const curPrice = quotes[stock.symbol]?.currentPrice || stock.buyPrice;

              invested += stock.shares * stock.buyPrice;
              currentVal += remaining * curPrice;
              stock.transactions.forEach((t) => {
                realized += t.shares * (t.price - stock.buyPrice);
              });
            });

            const pnl = currentVal + realized - invested;
            const pnlPercent = invested > 0 ? (pnl / invested) * 100 : 0;

            return (
              <Col xs={24} md={12} lg={8} key={campaign._id}>
                <Card
                  className="campaign-card"
                  hoverable
                  onClick={() => router.push(`/campaigns/${campaign._id}`)}
                  actions={[
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
                      <Button type="text" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} size="small">
                        Delete
                      </Button>
                    </Popconfirm>,
                    <Button key="view" type="text" icon={<RightOutlined />} size="small">
                      View
                    </Button>,
                  ]}>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>{campaign.name}</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <Tag color="blue">{campaign.stocks.length} stocks</Tag>
                      <Tag color="default">{campaign.moneyLocations.length} locations</Tag>
                      {campaign.startDate && <Tag color="purple">Started {new Date(campaign.startDate).toLocaleDateString()}</Tag>}
                    </div>
                  </div>

                  <Row gutter={8}>
                    <Col span={12}>
                      <Statistic
                        title={<span style={{ color: "#64748b", fontSize: 11 }}>Invested</span>}
                        value={invested}
                        prefix="$"
                        precision={0}
                        valueStyle={{ fontSize: 16, color: "#e2e8f0" }}
                      />
                    </Col>
                    <Col span={12}>
                      <div>
                        <div style={{ color: "#64748b", fontSize: 11, marginBottom: 8 }}>P&L</div>
                        <PnLDisplay value={pnl} percentage={pnlPercent} size="small" />
                      </div>
                    </Col>
                  </Row>
                </Card>
              </Col>
            );
          })}
        </Row>
      }

      <CreateCampaignModal open={createModal} onClose={() => setCreateModal(false)} />
    </div>
  );
}
