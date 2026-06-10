"use client";

import React, { useState, useMemo } from "react";
import { Card, Row, Col, Statistic, Spin, Skeleton, Popconfirm, message } from "antd";
import { PlusOutlined, DeleteOutlined, EditOutlined, FolderOutlined, RightOutlined, FundOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useStore } from "@/context/StoreContext";
import { useStockQuotes } from "@/hooks/useStockQuote";
import CreateCampaignModal from "@/components/campaigns/CreateCampaignModal";
import PnLDisplay from "@/components/shared/PnLDisplay";
import { calculateCampaignStats } from "@/lib/campaignStats";
import { Campaign, CampaignStock, StockQuote } from "@/types";
import { Button } from "@/components/ui/button";

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

  const { quotes, loading: quotesLoading } = useStockQuotes(allSymbols);

  // Quote-dependent values (current value, P&L, day change) are loaded separately
  // from the campaign data, so show skeletons until the first quotes arrive.
  const quotesPending = allSymbols.length > 0 && quotesLoading && Object.keys(quotes).length === 0;

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
        <Button variant="default" size="lg" onClick={() => setCreateModal(true)}>
          <PlusOutlined />
          New Campaign
        </Button>
      </div>

      {state.campaigns.length === 0 ?
        <div className="empty-state">
          <FolderOutlined className="empty-state-icon" />
          <p className="empty-state-text">No campaigns yet. Create your first campaign to start tracking stocks.</p>
          <Button variant="default" size="lg" onClick={() => setCreateModal(true)}>
            <PlusOutlined />
            Create Campaign
          </Button>
        </div>
      : <>
          <div className="stats-grid animate-in">
            <Card className="stat-card" bordered={false}>
              <div style={{ color: "#64748b", fontSize: 14, marginBottom: 8 }}>Total in Stocks</div>
              {quotesPending ?
                <Skeleton.Input active size="large" style={{ width: 160 }} />
              : <Statistic
                  value={portfolioStats.totalCurrentValue}
                  prefix={<FundOutlined style={{ color: "#00d4aa" }} />}
                  precision={2}
                  valueStyle={{ color: "#e2e8f0" }}
                  formatter={(value) => `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
                />
              }
            </Card>
            <Card className="stat-card" bordered={false}>
              <div style={{ color: "#64748b", fontSize: 14, marginBottom: 8 }}>Avg Day Change</div>
              {quotesPending ?
                <Skeleton.Input active size="large" style={{ width: 160 }} />
              : <PnLDisplay value={portfolioStats.dayChange} percentage={portfolioDayChangePercent} size="large" />}
            </Card>
            <Card className="stat-card" bordered={false}>
              <div style={{ color: "#64748b", fontSize: 14, marginBottom: 8 }}>Total P&L</div>
              {quotesPending ?
                <Skeleton.Input active size="large" style={{ width: 160 }} />
              : <PnLDisplay value={portfolioStats.totalPnl} percentage={portfolioPnlPercent} size="large" />}
            </Card>
          </div>

          <Row gutter={[20, 20]}>
            {state.campaigns.map((campaign) => {
              const stats = calculateCampaignStats(campaign, quotes);
              const dayChange = calculateCampaignDayChange(campaign, quotes);

              return (
                <Col xs={24} lg={12} xl={8} key={campaign._id}>
                  <div
                    className="flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[radial-gradient(circle_at_top_left,rgba(0,212,170,0.08),transparent_34%),var(--bg-secondary)] transition-all duration-300 ease-in-out hover:-translate-y-0.5 hover:border-gray-200/20 hover:shadow-gray-300"
                    onClick={() => router.push(`/campaigns/${campaign._id}`)}>
                    <div className="flex-1 p-5 max-[420px]:p-[18px]">
                      <div className="mb-[18px] min-w-0">
                        <div className="mb-2.5 text-[19px] font-bold leading-tight text-[var(--text-primary)] break-words">
                          {campaign.name}
                        </div>
                        <div className="flex min-w-0 flex-wrap gap-2">
                          <span className="inline-flex max-w-full min-h-[26px] items-center rounded-full border border-[rgba(0,212,170,0.26)] bg-[rgba(0,212,170,0.1)] px-2.5 py-1 text-xs font-semibold leading-tight text-[#8ff3dc] break-words">
                            {campaign.stocks.length} stocks
                          </span>
                          <span className="inline-flex max-w-full min-h-[26px] items-center rounded-full border border-slate-400/16 bg-[rgba(15,22,41,0.82)] px-2.5 py-1 text-xs font-semibold leading-tight text-[var(--text-secondary)] break-words">
                            {campaign.moneyLocations.length} locations
                          </span>
                          {campaign.startDate && (
                            <span className="inline-flex max-w-full min-h-[26px] items-center rounded-full border border-violet-500/24 bg-violet-500/10 px-2.5 py-1 text-xs font-semibold leading-tight text-violet-300 break-words">
                              Started {new Date(campaign.startDate).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] items-start gap-3 max-[420px]:grid-cols-1">
                        <div className="min-w-0 [&_.ant-statistic-content]:max-w-full [&_.ant-statistic-content]:break-words">
                          <Statistic
                            title={
                              <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Invested</span>
                            }
                            value={stats.invested}
                            prefix="$"
                            precision={0}
                            valueStyle={{ fontSize: 16, color: "#e2e8f0", lineHeight: 1.15 }}
                          />
                        </div>
                        <div className="min-w-0 [&_.ant-statistic-content]:max-w-full [&_.ant-statistic-content]:break-words">
                          <div className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">In Stocks</div>
                          {quotesPending ?
                            <Skeleton.Input active size="small" style={{ width: 90 }} />
                          : <Statistic
                              value={stats.currentValue}
                              prefix="$"
                              precision={0}
                              valueStyle={{ fontSize: 16, color: "#e2e8f0", lineHeight: 1.15 }}
                            />
                          }
                        </div>
                        <div className="min-w-0 [&_span]:max-w-full [&_span]:flex-wrap [&_span]:break-words">
                          <div className="min-w-0">
                            <div className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">P&L</div>
                            {quotesPending ?
                              <Skeleton.Input active size="small" style={{ width: 90 }} />
                            : <PnLDisplay value={stats.pnl} percentage={stats.pnlPercent} size="small" />}
                          </div>
                        </div>
                        <div className="min-w-0 [&_span]:max-w-full [&_span]:flex-wrap [&_span]:break-words">
                          <div className="min-w-0">
                            <div className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-[#64748b]">Day Change</div>
                            {quotesPending ?
                              <Skeleton.Input active size="small" style={{ width: 90 }} />
                            : <PnLDisplay value={dayChange.value} percentage={dayChange.percentage} size="small" />}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-auto grid grid-cols-3 border-t border-[var(--border)] bg-[rgba(10,14,26,0.42)] max-[420px]:grid-cols-1">
                      <div className="min-w-0 border-r border-[var(--border)] max-[420px]:border-r-0 max-[420px]:border-b">
                        <Button
                          variant="ghost"
                          className="w-full max-w-full !rounded-none font-medium text-[var(--text-primary)] transition-all duration-200 hover:bg-white/6 hover:shadow-[0_2px_10px_rgba(0,0,0,0.28)]"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingCampaign(campaign);
                          }}
                          size="lg">
                          <EditOutlined />
                          Edit
                        </Button>
                      </div>
                      <div className="min-w-0 border-r border-[var(--border)] max-[420px]:border-r-0 max-[420px]:border-b">
                        <Popconfirm
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
                            variant="ghost"
                            className="w-full max-w-full !rounded-none font-medium transition-all duration-200 hover:bg-red-300/15 hover:text-red-500 "
                            onClick={(e) => e.stopPropagation()}
                            size="lg">
                            <DeleteOutlined />
                            Delete
                          </Button>
                        </Popconfirm>
                      </div>
                      <div className="min-w-0">
                        <Button
                          variant="ghost"
                          className="w-full max-w-full !rounded-none font-medium text-[var(--text-primary)] transition-all duration-200 hover:bg-white/6 hover:shadow-[0_2px_10px_rgba(0,0,0,0.28)]"
                          size="lg">
                          <RightOutlined />
                          View
                        </Button>
                      </div>
                    </div>
                  </div>
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
