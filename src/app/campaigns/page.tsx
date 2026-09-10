"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Spin, Skeleton, message } from "antd";
import { PlusOutlined, FolderOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useStore } from "@/context/StoreContext";
import { useStockQuotes } from "@/hooks/useStockQuote";
import { usePeriodPrices } from "@/hooks/usePeriodPrices";
import CreateCampaignModal from "@/components/campaigns/CreateCampaignModal";
import CampaignActionsDropdown from "@/components/campaigns/CampaignActionsDropdown";
import CampaignSummary from "@/components/campaigns/CampaignSummary";
import MetaLine from "@/components/shared/MetaLine";
import PnLDisplay from "@/components/shared/PnLDisplay";
import { calculateCampaignStats, calculateCampaignMonthlyChange, calculateCampaignAnnualPnL } from "@/lib/campaignStats";
import { formatStockSummary, formatUsd, getCampaignMetaParts } from "@/lib/campaignFormat";
import { getRemainingShares } from "@/lib/shares";
import { Campaign, StockQuote } from "@/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DayChangeStats = {
  value: number;
  percentage: number;
  basis: number;
};

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);


const isCampaignFullySoldOut = (campaign: Campaign) =>
  campaign.stocks.length > 0 && campaign.stocks.every((stock) => getRemainingShares(stock) <= 0);

const isCampaignClosed = (campaign: Campaign) => campaign.closed === true;

/* Closed by hand or sold out entirely — either way it belongs at the bottom. */
const isCampaignInactive = (campaign: Campaign) => isCampaignClosed(campaign) || isCampaignFullySoldOut(campaign);

const getActiveStockCount = (campaign: Campaign) => campaign.stocks.filter((stock) => getRemainingShares(stock) > 0).length;

const CAMPAIGN_COLLAPSED_STORAGE_KEY = "campaign-collapsed";

const loadCollapsedState = (): Record<string, boolean> => {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(CAMPAIGN_COLLAPSED_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
};

const getIsCollapsed = (campaign: Campaign, collapsedById: Record<string, boolean>) => {
  const id = campaign._id;
  if (!id) return false;
  if (id in collapsedById) return collapsedById[id];
  return isCampaignInactive(campaign);
};

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

/* Filled accent capsule — the page's one prominent action. */
const PRIMARY_ACTION_CLASS = "rounded-full bg-[#f5f5f5] px-5 font-semibold text-[#0a0e1a] hover:bg-white max-sm:h-11";

export default function CampaignsPage() {
  const { state, dispatch } = useStore();
  const router = useRouter();
  const [createModal, setCreateModal] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [collapsedById, setCollapsedById] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCollapsedById(loadCollapsedState());
  }, []);

  const setCampaignCollapsed = useCallback((campaignId: string, resolve: (current: Record<string, boolean>) => boolean) => {
    setCollapsedById((current) => {
      const next = { ...current, [campaignId]: resolve(current) };

      try {
        window.localStorage.setItem(CAMPAIGN_COLLAPSED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage failures and keep in-memory state.
      }

      return next;
    });
  }, []);

  const toggleCampaignCollapsed = useCallback(
    (campaignId: string) => {
      setCampaignCollapsed(campaignId, (current) => {
        const campaign = state.campaigns.find((item) => item._id === campaignId);
        return campaign ? !getIsCollapsed(campaign, current) : true;
      });
    },
    [setCampaignCollapsed, state.campaigns],
  );

  // Active campaigns lead; closed and sold-out ones get their own section. Hidden cards sink within each group.
  const { activeCampaigns, closedCampaigns } = useMemo(() => {
    const byCollapsed = (a: Campaign, b: Campaign) =>
      Number(getIsCollapsed(a, collapsedById)) - Number(getIsCollapsed(b, collapsedById));

    return {
      activeCampaigns: state.campaigns.filter((campaign) => !isCampaignInactive(campaign)).sort(byCollapsed),
      closedCampaigns: state.campaigns.filter(isCampaignInactive).sort(byCollapsed),
    };
  }, [state.campaigns, collapsedById]);

  // Collect all symbols
  const allSymbols = useMemo(() => {
    const s = new Set<string>();
    state.campaigns.forEach((c) => c.stocks.forEach((st) => s.add(st.symbol)));
    return Array.from(s);
  }, [state.campaigns]);

  const { quotes, loading: quotesLoading } = useStockQuotes(allSymbols);
  const { monthStartPrices, yearStartPrices, loading: periodPricesLoading } = usePeriodPrices(allSymbols);

  // Quote-dependent values (current value, P&L, day change) are loaded separately
  // from the campaign data, so show skeletons until the first quotes arrive.
  const quotesPending = allSymbols.length > 0 && quotesLoading && Object.keys(quotes).length === 0;
  const periodPricesPending = allSymbols.length > 0 && periodPricesLoading && Object.keys(monthStartPrices).length === 0;

  const portfolioStats = useMemo(() => {
    return state.campaigns.reduce(
      (totals, campaign) => {
        const stats = calculateCampaignStats(campaign, quotes);
        const dayChange = calculateCampaignDayChange(campaign, quotes);
        const monthChange = calculateCampaignMonthlyChange(campaign, quotes, monthStartPrices);
        const annualPnl = calculateCampaignAnnualPnL(campaign, quotes, yearStartPrices);

        return {
          totalCurrentValue: totals.totalCurrentValue + stats.currentValue,
          totalPnl: totals.totalPnl + stats.pnl,
          totalPnlBasis: totals.totalPnlBasis + stats.costBasis,
          dayChange: totals.dayChange + dayChange.value,
          dayChangeBasis: totals.dayChangeBasis + dayChange.basis,
          monthChange: totals.monthChange + monthChange.value,
          monthChangeBasis: totals.monthChangeBasis + monthChange.basis,
          annualPnl: totals.annualPnl + annualPnl.pnl,
          annualPnlBasis: totals.annualPnlBasis + annualPnl.basis,
        };
      },
      {
        totalCurrentValue: 0,
        totalPnl: 0,
        totalPnlBasis: 0,
        dayChange: 0,
        dayChangeBasis: 0,
        monthChange: 0,
        monthChangeBasis: 0,
        annualPnl: 0,
        annualPnlBasis: 0,
      },
    );
  }, [state.campaigns, quotes, monthStartPrices, yearStartPrices]);

  const portfolioPnlPercent = portfolioStats.totalPnlBasis > 0 ? (portfolioStats.totalPnl / portfolioStats.totalPnlBasis) * 100 : 0;
  const portfolioDayChangePercent =
    portfolioStats.dayChangeBasis > 0 ? (portfolioStats.dayChange / portfolioStats.dayChangeBasis) * 100 : 0;
  const portfolioMonthChangePercent =
    portfolioStats.monthChangeBasis > 0 ? (portfolioStats.monthChange / portfolioStats.monthChangeBasis) * 100 : 0;
  const portfolioAnnualPnlPercent =
    portfolioStats.annualPnlBasis > 0 ? (portfolioStats.annualPnl / portfolioStats.annualPnlBasis) * 100 : 0;

  // Ordered by time horizon, shortest first.
  const summaryMetrics = [
    { label: "Today", value: portfolioStats.dayChange, percentage: portfolioDayChangePercent, pending: quotesPending },
    {
      label: "This Month",
      value: portfolioStats.monthChange,
      percentage: portfolioMonthChangePercent,
      pending: quotesPending || periodPricesPending,
    },
    {
      label: "This Year",
      value: portfolioStats.annualPnl,
      percentage: portfolioAnnualPnlPercent,
      pending: quotesPending || periodPricesPending,
    },
    { label: "Total P&L", value: portfolioStats.totalPnl, percentage: portfolioPnlPercent, pending: quotesPending },
  ];

  const handleToggleClosed = async (campaign: Campaign) => {
    const id = campaign._id;
    if (!id) return;

    const nextClosed = !isCampaignClosed(campaign);

    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closed: nextClosed }),
      });

      if (!res.ok) {
        message.error(nextClosed ? "Could not close campaign" : "Could not reopen campaign");
        return;
      }

      const updated: Campaign = await res.json();
      dispatch({ type: "UPDATE_CAMPAIGN", payload: updated });
      // Closing tucks the card away; reopening brings it back expanded.
      setCampaignCollapsed(id, () => nextClosed);
      message.success(nextClosed ? `"${campaign.name}" closed` : `"${campaign.name}" reopened`);
    } catch (e) {
      console.error("Toggle campaign closed error:", e);
      message.error("Something went wrong");
    }
  };

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

  const renderCampaign = (campaign: Campaign) => {
    const stats = calculateCampaignStats(campaign, quotes);
    const dayChange = calculateCampaignDayChange(campaign, quotes);
    const collapsed = getIsCollapsed(campaign, collapsedById);
    const fullySoldOut = isCampaignFullySoldOut(campaign);
    const closed = isCampaignClosed(campaign);
    const inactive = isCampaignInactive(campaign);
    const activeStockCount = getActiveStockCount(campaign);
    const metaParts =
      collapsed ?
        [formatStockSummary(activeStockCount, campaign.stocks.length)]
      : getCampaignMetaParts(campaign, activeStockCount);
    const valueSkeleton = <Skeleton.Input active size="small" style={{ width: 120 }} />;

    return (
      <article
        key={campaign._id}
        className={cn(
          "campaign-list-card",
          collapsed && "campaign-list-card-collapsed",
          inactive && "campaign-list-card-inactive",
        )}
        onClick={(event) => {
          // Let buttons, menus and popconfirms handle their own clicks.
          if ((event.target as HTMLElement).closest("button, a, input, [role='menu'], [role='menuitem']")) return;
          router.push(`/campaigns/${campaign._id}`);
        }}>
        <div className="campaign-list-card-header">
          <div className="campaign-list-card-heading">
            <div className="campaign-list-card-title-row">
              <button type="button" className="campaign-list-card-title" onClick={() => router.push(`/campaigns/${campaign._id}`)}>
                {campaign.name}
              </button>
              {closed && <span className="campaign-status">Closed</span>}
              {fullySoldOut && <span className="campaign-status">Fully Sold</span>}
            </div>
            <MetaLine parts={metaParts} className="campaign-list-card-subtitle" />
          </div>

          {collapsed && (
            <div className="campaign-list-card-summary">
              {quotesPending ?
                valueSkeleton
              : fullySoldOut ?
                <PnLDisplay value={stats.realized} />
              : <PnLDisplay value={stats.pnl} percentage={stats.pnlPercent} />}
            </div>
          )}

          <div className="campaign-list-card-menu">
            <CampaignActionsDropdown
              campaignName={campaign.name}
              collapsed={collapsed}
              closed={closed}
              onEdit={() => setEditingCampaign(campaign)}
              onToggleCollapsed={() => campaign._id && toggleCampaignCollapsed(campaign._id)}
              onToggleClosed={() => handleToggleClosed(campaign)}
              onDelete={() => handleDelete(campaign._id!)}
            />
          </div>
        </div>

        {!collapsed && (
          <div className="campaign-list-card-body">
            <dl className="campaign-list-card-hero">
              <dt>In Stocks</dt>
              <dd>{quotesPending ? valueSkeleton : formatUsd(stats.currentValue, 0)}</dd>
            </dl>

            <dl className="campaign-list-card-rows">
              <div className="campaign-list-card-row">
                <dt>Invested</dt>
                <dd>{formatUsd(stats.invested, 0)}</dd>
              </div>
              <div className="campaign-list-card-row">
                <dt>Total P&L</dt>
                <dd>{quotesPending ? valueSkeleton : <PnLDisplay value={stats.pnl} percentage={stats.pnlPercent} />}</dd>
              </div>
              <div className="campaign-list-card-row">
                <dt>Today</dt>
                <dd>
                  {quotesPending ? valueSkeleton : <PnLDisplay value={dayChange.value} percentage={dayChange.percentage} />}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </article>
    );
  };

  if (state.loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="page-container campaigns-page campaigns-container">
      <div className="page-header">
        <h1>Campaigns</h1>
        <Button className={PRIMARY_ACTION_CLASS} onClick={() => setCreateModal(true)}>
          <PlusOutlined />
          New Campaign
        </Button>
      </div>

      {state.campaigns.length === 0 ?
        <div className="empty-state">
          <FolderOutlined className="empty-state-icon" />
          <p className="empty-state-text">No campaigns yet. Create your first campaign to start tracking stocks.</p>
          <Button className={PRIMARY_ACTION_CLASS} onClick={() => setCreateModal(true)}>
            <PlusOutlined />
            Create Campaign
          </Button>
        </div>
      : <>
          <CampaignSummary
            label="Total in Stocks"
            value={portfolioStats.totalCurrentValue}
            pending={quotesPending}
            metrics={summaryMetrics}
          />

          {activeCampaigns.length > 0 && <div className="campaigns-grid">{activeCampaigns.map(renderCampaign)}</div>}

          {closedCampaigns.length > 0 && (
            <section className="campaigns-section" aria-labelledby="closed-campaigns-title">
              <h2 id="closed-campaigns-title" className="campaigns-section-title">
                Closed <span className="campaigns-section-count">{closedCampaigns.length}</span>
              </h2>
              <div className="campaigns-grid">{closedCampaigns.map(renderCampaign)}</div>
            </section>
          )}
        </>
      }

      <CreateCampaignModal open={createModal} onClose={() => setCreateModal(false)} />
      <CreateCampaignModal open={Boolean(editingCampaign)} onClose={() => setEditingCampaign(null)} campaign={editingCampaign} />
    </div>
  );
}
