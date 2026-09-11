"use client";

import React, { useMemo, useState } from "react";
import { Button, Skeleton, Modal, Input, AutoComplete, message, Popconfirm, Typography } from "antd";
import { PlusOutlined, DeleteOutlined } from "@ant-design/icons";
import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useStore } from "@/context/StoreContext";
import { useStockQuotes } from "@/hooks/useStockQuote";
import { usePeriodPrices } from "@/hooks/usePeriodPrices";
import CampaignSummary, { SummaryMetric } from "@/components/campaigns/CampaignSummary";
import MetaLine from "@/components/shared/MetaLine";
import PnLDisplay from "@/components/shared/PnLDisplay";
import { Button as UiButton } from "@/components/ui/button";
import {
  annualForStocks,
  assetOptions,
  AssetStock,
  buildAssetGroups,
  DEFAULT_ASSETS,
  formatCurrency,
  getCostPerShare,
  getRemainingShares,
  getSoldShares,
  isSoldOut,
  lastDayForStocks,
  normalizeName,
  planRenameAsset,
  slugify,
  statsForStocks,
} from "@/lib/assets";
import { formatStockSummary, formatUsd, pluralize } from "@/lib/campaignFormat";
import { cn } from "@/lib/utils";

type DisplayAccount = {
  key: string;
  slug: string;
  name: string;
  stocks: AssetStock[];
  registered: boolean;
  builtIn: boolean;
  assetId?: string;
};

const SKELETON_METRICS: SummaryMetric[] = ["Today", "This Year", "Total P&L", "Realized"].map((label) => ({
  label,
  value: 0,
  percentage: 0,
  pending: true,
}));

function AssetsPageSkeleton() {
  return (
    <div className="page-container campaigns-page campaigns-container">
      <div className="page-header">
        <h1>Assets</h1>
        <Skeleton.Button active size="large" shape="round" style={{ width: 128 }} />
      </div>
      <CampaignSummary label="Sellable Value" value={0} pending metrics={SKELETON_METRICS} />
      <div className="campaigns-grid">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="campaigns-panel campaigns-panel-padded">
            <Skeleton active title={{ width: "50%" }} paragraph={{ rows: 3 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AssetsPage() {
  const router = useRouter();
  const { state, dispatch, fetchCampaigns, fetchAssets } = useStore();
  const campaigns = state.campaigns;

  const [createOpen, setCreateOpen] = useState(false);
  const [newAssetName, setNewAssetName] = useState("");
  const [creating, setCreating] = useState(false);

  const [renameAccount, setRenameAccount] = useState<DisplayAccount | null>(null);
  const [renameTarget, setRenameTarget] = useState("");
  const [renaming, setRenaming] = useState(false);

  const assetGroups = useMemo(() => buildAssetGroups(campaigns), [campaigns]);

  const symbols = useMemo(() => {
    const all = new Set<string>();
    assetGroups.forEach((group) => group.stocks.forEach((stock) => all.add(stock.symbol)));
    return Array.from(all);
  }, [assetGroups]);

  const { quotes, loading: quotesLoading } = useStockQuotes(symbols);
  const { yearStartPrices, loading: periodPricesLoading } = usePeriodPrices(symbols);
  const quotesPending = symbols.length > 0 && quotesLoading && Object.keys(quotes).length === 0;
  const periodPricesPending = symbols.length > 0 && periodPricesLoading && Object.keys(yearStartPrices).length === 0;

  // Build the full asset list: built-in institutions + registered + any in use.
  const displayAccounts = useMemo<DisplayAccount[]>(() => {
    const map = new Map<string, DisplayAccount>();

    DEFAULT_ASSETS.forEach((name) => {
      map.set(normalizeName(name), { key: normalizeName(name), slug: slugify(name), name, stocks: [], registered: false, builtIn: true });
    });

    assetGroups.forEach((group) => {
      if (group.key === "unassigned") return;
      const existing = map.get(group.key);
      if (existing) {
        existing.stocks = group.stocks;
        existing.slug = group.slug;
      } else {
        map.set(group.key, { key: group.key, slug: group.slug, name: group.name, stocks: group.stocks, registered: false, builtIn: false });
      }
    });

    state.assets.forEach((asset) => {
      const key = normalizeName(asset.name);
      const existing = map.get(key);
      if (existing) {
        existing.registered = true;
        existing.assetId = asset._id;
      } else {
        map.set(key, { key, slug: slugify(asset.name), name: asset.name, stocks: [], registered: true, builtIn: false, assetId: asset._id });
      }
    });

    const list = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));

    const unassigned = assetGroups.find((group) => group.key === "unassigned");
    if (unassigned) {
      list.push({ key: "unassigned", slug: unassigned.slug, name: "Unassigned", stocks: unassigned.stocks, registered: false, builtIn: false });
    }
    return list;
  }, [assetGroups, state.assets]);

  const allStocks = useMemo(() => assetGroups.flatMap((group) => group.stocks), [assetGroups]);
  const overallStats = statsForStocks(allStocks, quotes);
  const overallLastDay = lastDayForStocks(allStocks, quotes);
  const overallAnnual = annualForStocks(allStocks, quotes, yearStartPrices);
  const realizedBasis = allStocks.reduce((sum, stock) => sum + getSoldShares(stock) * getCostPerShare(stock), 0);

  const handleCreateAsset = async () => {
    const name = newAssetName.trim();
    if (!name) {
      message.error("Enter an asset name");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const asset = await res.json();
        dispatch({ type: "ADD_ASSET", payload: asset });
        message.success("Asset created");
        setNewAssetName("");
        setCreateOpen(false);
      } else if (res.status === 409) {
        message.warning("An asset with that name already exists");
      } else {
        message.error("Could not create asset");
      }
    } catch (e) {
      console.error("Create asset error:", e);
      message.error("Could not create asset");
    } finally {
      setCreating(false);
    }
  };

  const openRename = (account: DisplayAccount) => {
    setRenameAccount(account);
    setRenameTarget(account.name);
  };

  const handleRename = async () => {
    if (!renameAccount) return;
    const target = renameTarget.trim();
    if (!target) {
      message.error("Enter a name");
      return;
    }
    if (normalizeName(target) === renameAccount.key) {
      setRenameAccount(null);
      return;
    }

    setRenaming(true);
    try {
      const updatedCampaigns = planRenameAsset(campaigns, renameAccount.key, target);
      for (const campaign of updatedCampaigns) {
        const res = await fetch(`/api/campaigns/${campaign._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ moneyLocations: campaign.moneyLocations, stocks: campaign.stocks }),
        });
        if (!res.ok) throw new Error(`Failed to update campaign ${campaign.name}`);
      }

      // Keep the asset registry tidy: register the new name, drop the old custom one.
      await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: target }),
      });
      if (renameAccount.assetId) {
        await fetch(`/api/assets/${renameAccount.assetId}`, { method: "DELETE" });
      }

      await Promise.all([fetchCampaigns(), fetchAssets()]);

      const merged = displayAccounts.some(
        (account) => account.key === normalizeName(target) && account.key !== renameAccount.key && account.stocks.length > 0,
      );
      message.success(merged ? `Merged into "${target}"` : `Renamed to "${target}"`);
      setRenameAccount(null);
    } catch (e) {
      console.error("Rename asset error:", e);
      message.error("Could not rename asset");
    } finally {
      setRenaming(false);
    }
  };

  const handleDeleteAsset = async (assetId?: string) => {
    if (!assetId) return;
    try {
      const res = await fetch(`/api/assets/${assetId}`, { method: "DELETE" });
      if (res.ok) {
        dispatch({ type: "DELETE_ASSET", payload: assetId });
        message.success("Asset removed");
      } else {
        message.error("Could not remove asset");
      }
    } catch (e) {
      console.error("Delete asset error:", e);
      message.error("Could not remove asset");
    }
  };

  if (state.loading) {
    return <AssetsPageSkeleton />;
  }

  // Ordered by time horizon, shortest first; realized gains close the row.
  const summaryMetrics: SummaryMetric[] = [
    { label: "Today", value: overallLastDay.value, percentage: overallLastDay.percentage, pending: quotesPending },
    {
      label: "This Year",
      value: overallAnnual.pnl,
      percentage: overallAnnual.pnlPercent,
      pending: quotesPending || periodPricesPending,
    },
    { label: "Total P&L", value: overallStats.pnl, percentage: overallStats.pnlPercent, pending: quotesPending },
    {
      label: "Realized",
      value: overallStats.realized,
      percentage: realizedBasis > 0 ? (overallStats.realized / realizedBasis) * 100 : 0,
    },
  ];

  const getOpenPositions = (account: DisplayAccount) => account.stocks.filter((stock) => !isSoldOut(stock)).length;

  // Accounts holding stocks lead as cards, fully sold ones sinking to the end; the rest are only names
  // to pick from, so they get a quiet list.
  const heldAccounts = displayAccounts
    .filter((account) => account.stocks.length > 0)
    .sort((a, b) => Number(getOpenPositions(a) === 0) - Number(getOpenPositions(b) === 0));
  const emptyAccounts = displayAccounts.filter((account) => account.stocks.length === 0);

  const renderAccount = (account: DisplayAccount) => {
    const stats = statsForStocks(account.stocks, quotes);
    const lastDay = lastDayForStocks(account.stocks, quotes);
    const positions = getOpenPositions(account);
    const fullySold = positions === 0;
    const campaignCount = new Set(account.stocks.map((stock) => stock.campaignId)).size;
    const prepareStocks = account.stocks.filter((stock) => !isSoldOut(stock) && stock.prepareToSell);
    const prepareValue = prepareStocks.reduce((sum, stock) => {
      const currentPrice = quotes[stock.symbol]?.currentPrice ?? stock.buyPrice;
      return sum + getRemainingShares(stock) * currentPrice;
    }, 0);
    const valueSkeleton = <Skeleton.Input active size="small" style={{ width: 120 }} />;
    const open = () => router.push(`/assets/${account.slug}`);

    return (
      <article
        key={account.key}
        className={cn(
          "campaign-list-card",
          fullySold && "campaign-list-card-inactive",
          prepareStocks.length > 0 && "campaign-list-card-flagged",
        )}
        onClick={(event) => {
          // Let the title and rename buttons handle their own clicks.
          if ((event.target as HTMLElement).closest("button, a, input")) return;
          open();
        }}>
        <div className="campaign-list-card-header">
          <div className="campaign-list-card-heading">
            <div className="campaign-list-card-title-row">
              <button type="button" className="campaign-list-card-title" onClick={open}>
                {account.name}
              </button>
              {account.registered && <span className="campaign-status">Custom</span>}
              {fullySold && <span className="campaign-status">Fully Sold</span>}
              {prepareStocks.length > 0 && (
                <span className="campaign-status campaign-status-alert">
                  {prepareStocks.length} to sell · {formatCurrency(prepareValue)}
                </span>
              )}
            </div>
            <MetaLine
              parts={[formatStockSummary(positions, account.stocks.length), pluralize(campaignCount, "campaign")]}
              className="campaign-list-card-subtitle"
            />
          </div>

          <div className="campaign-list-card-menu">
            <UiButton
              variant="ghost"
              size="icon-sm"
              aria-label={`Rename ${account.name}`}
              title="Rename or merge"
              onClick={() => openRename(account)}>
              <Pencil />
            </UiButton>
          </div>
        </div>

        <div className="campaign-list-card-body">
          <dl className="campaign-list-card-hero">
            <dt>Sellable Value</dt>
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
            {/* Nothing left to move today once everything is sold; what it made is the figure that matters. */}
            {fullySold ?
              <div className="campaign-list-card-row">
                <dt>Realized</dt>
                <dd>
                  <PnLDisplay value={stats.realized} />
                </dd>
              </div>
            : <div className="campaign-list-card-row">
                <dt>Today</dt>
                <dd>{quotesPending ? valueSkeleton : <PnLDisplay value={lastDay.value} percentage={lastDay.percentage} />}</dd>
              </div>
            }
          </dl>
        </div>
      </article>
    );
  };

  return (
    <div className="page-container campaigns-page campaigns-container">
      <div className="page-header">
        <h1>Assets</h1>
        <Button
          type="primary"
          shape="round"
          size="large"
          icon={<PlusOutlined />}
          className="campaigns-primary-action"
          onClick={() => setCreateOpen(true)}>
          New Asset
        </Button>
      </div>

      <CampaignSummary
        label="Sellable Value"
        value={overallStats.currentValue}
        pending={quotesPending}
        detail={`Invested ${formatUsd(overallStats.invested)}`}
        metrics={summaryMetrics}
      />

      {heldAccounts.length > 0 && <div className="campaigns-grid">{heldAccounts.map(renderAccount)}</div>}

      {emptyAccounts.length > 0 && (
        <section className="campaigns-section" aria-labelledby="empty-assets-title">
          <h2 id="empty-assets-title" className="campaigns-section-title">
            No Holdings <span className="campaigns-section-count">{emptyAccounts.length}</span>
          </h2>
          <p className="campaigns-section-footnote">Ready to pick when you add a stock to any campaign.</p>
          <ul className="grouped-list grouped-list-inactive">
            {emptyAccounts.map((account) => (
              <li key={account.key} className="grouped-list-row">
                <div className="grouped-list-main">
                  <span className="grouped-list-title">{account.name}</span>
                </div>
                {account.registered && <span className="campaign-status">Custom</span>}
                {account.registered && !account.builtIn && (
                  <Popconfirm
                    title="Remove this asset?"
                    description="This only removes it from your asset list; campaigns are untouched."
                    onConfirm={() => handleDeleteAsset(account.assetId)}>
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      aria-label={`Remove ${account.name}`}
                      style={{ width: 36, height: 36 }}
                    />
                  </Popconfirm>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Create asset modal */}
      <Modal
        title="New asset"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={handleCreateAsset}
        okText="Create"
        confirmLoading={creating}
        destroyOnClose>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
          Create an asset/account once (e.g. a brokerage or wallet). It then becomes selectable when you add stocks to any
          campaign.
        </Typography.Paragraph>
        <Input
          autoFocus
          placeholder="Asset name (e.g. Fidelity Dan)"
          value={newAssetName}
          onChange={(e) => setNewAssetName(e.target.value)}
          onPressEnter={handleCreateAsset}
          size="large"
        />
      </Modal>

      {/* Rename / merge modal */}
      <Modal
        title={`Rename "${renameAccount?.name ?? ""}"`}
        open={!!renameAccount}
        onCancel={() => setRenameAccount(null)}
        onOk={handleRename}
        okText="Save"
        confirmLoading={renaming}
        destroyOnClose>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
          This renames the account everywhere it&apos;s used across your campaigns. Renaming it to an existing asset will merge
          them.
        </Typography.Paragraph>
        <AutoComplete
          value={renameTarget}
          options={assetOptions(campaigns, state.assets.map((a) => a.name)).map((value) => ({ value }))}
          onChange={(v) => setRenameTarget(v)}
          style={{ width: "100%" }}
          size="large"
          placeholder="New name (e.g. Fidelity Roth Dan)"
          filterOption={(input, option) => (option?.value ?? "").toLowerCase().includes(input.toLowerCase())}
        />
      </Modal>
    </div>
  );
}
