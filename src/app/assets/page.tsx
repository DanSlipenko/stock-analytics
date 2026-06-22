"use client";

import React, { useMemo, useState } from "react";
import { Card, Button, Statistic, Row, Col, Empty, Skeleton, Modal, Input, AutoComplete, message, Popconfirm, Tag, Typography } from "antd";
import {
  BankOutlined,
  DollarOutlined,
  TrophyOutlined,
  WalletOutlined,
  RightOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
} from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { useStore } from "@/context/StoreContext";
import { useStockQuotes } from "@/hooks/useStockQuote";
import {
  assetOptions,
  AssetStock,
  buildAssetGroups,
  DEFAULT_ASSETS,
  formatCurrency,
  getRemainingShares,
  isSoldOut,
  lastDayForStocks,
  normalizeName,
  planRenameAsset,
  slugify,
  statsForStocks,
} from "@/lib/assets";
import PnLDisplay from "@/components/shared/PnLDisplay";

type DisplayAccount = {
  key: string;
  slug: string;
  name: string;
  stocks: AssetStock[];
  registered: boolean;
  builtIn: boolean;
  assetId?: string;
};

function AssetsPageSkeleton() {
  return (
    <div className="page-container">
      <div className="page-header">
        <Skeleton.Input active size="large" style={{ width: 180 }} />
      </div>
      <div className="stats-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="stat-card" bordered={false}>
            <Skeleton.Input active size="small" style={{ width: 96, marginBottom: 10 }} />
            <Skeleton.Input active size="large" style={{ width: 160 }} />
          </Card>
        ))}
      </div>
      <Row gutter={[16, 16]}>
        {Array.from({ length: 4 }).map((_, index) => (
          <Col key={index} xs={24} md={12} lg={8}>
            <Card bordered={false} style={{ background: "#0f1629" }}>
              <Skeleton active paragraph={{ rows: 2 }} />
            </Card>
          </Col>
        ))}
      </Row>
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
  const quotesPending = symbols.length > 0 && quotesLoading && Object.keys(quotes).length === 0;

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

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="campaign-page-heading">
          <WalletOutlined style={{ fontSize: 22, color: "#3b82f6" }} />
          <h1>Assets</h1>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          New Asset
        </Button>
      </div>

      {/* Portfolio-wide summary */}
      <div className="stats-grid animate-in">
        <Card className="stat-card" bordered={false}>
          <Statistic
            title={<span style={{ color: "#64748b" }}>Invested</span>}
            value={overallStats.invested}
            prefix={<DollarOutlined style={{ color: "#3b82f6" }} />}
            precision={2}
            valueStyle={{ color: "#e2e8f0" }}
            formatter={(v) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
          />
        </Card>
        <Card className="stat-card" bordered={false}>
          <div style={{ color: "#64748b", fontSize: 14, marginBottom: 8 }}>Total Sellable Value</div>
          {quotesPending ?
            <Skeleton.Input active size="large" style={{ width: 160 }} />
          : <Statistic
              value={overallStats.currentValue}
              precision={2}
              valueStyle={{ color: "#e2e8f0" }}
              formatter={(v) => `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
            />
          }
        </Card>
        <Card className="stat-card" bordered={false}>
          <div style={{ color: "#64748b", fontSize: 14, marginBottom: 8 }}>Last Day</div>
          {quotesPending ?
            <Skeleton.Input active size="large" style={{ width: 160 }} />
          : <PnLDisplay value={overallLastDay.value} percentage={overallLastDay.percentage} size="large" />}
        </Card>
        <Card className="stat-card" bordered={false}>
          <div style={{ color: "#64748b", fontSize: 14, marginBottom: 8 }}>Total P&L</div>
          {quotesPending ?
            <Skeleton.Input active size="large" style={{ width: 160 }} />
          : <PnLDisplay value={overallStats.pnl} percentage={overallStats.pnlPercent} size="large" />}
        </Card>
        <Card className="stat-card" bordered={false}>
          <Statistic
            title={<span style={{ color: "#64748b" }}>Realized Gains</span>}
            prefix={<TrophyOutlined style={{ color: "#f59e0b" }} />}
            value={overallStats.realized}
            precision={2}
            valueStyle={{ color: overallStats.realized >= 0 ? "#22c55e" : "#ef4444" }}
            formatter={(v) => `${Number(v) >= 0 ? "+" : ""}$${Math.abs(Number(v)).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
          />
        </Card>
      </div>

      {/* Asset list */}
      <Card
        className="campaign-detail-card"
        title={
          <span style={{ color: "#e2e8f0", display: "flex", alignItems: "center", gap: 8 }}>
            <BankOutlined /> Assets
          </span>
        }
        bordered={false}>
        <Row gutter={[16, 16]}>
          {displayAccounts.map((account) => {
            const stats = statsForStocks(account.stocks, quotes);
            const positions = account.stocks.filter((stock) => !isSoldOut(stock)).length;
            const hasHoldings = account.stocks.length > 0;
            const removable = account.registered && !account.builtIn && !hasHoldings;
            const prepareStocks = account.stocks.filter((stock) => !isSoldOut(stock) && stock.prepareToSell);
            const prepareCount = prepareStocks.length;
            const prepareValue = prepareStocks.reduce((sum, stock) => {
              const currentPrice = quotes[stock.symbol]?.currentPrice ?? stock.buyPrice;
              return sum + getRemainingShares(stock) * currentPrice;
            }, 0);

            const onCardClick = () => {
              if (hasHoldings) router.push(`/assets/${account.slug}`);
            };

            return (
              <Col key={account.key} xs={24} md={12} lg={8}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={onCardClick}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && hasHoldings) {
                      e.preventDefault();
                      onCardClick();
                    }
                  }}
                  className="asset-account-card"
                  style={{
                    position: "relative",
                    width: "100%",
                    textAlign: "left",
                    cursor: hasHoldings ? "pointer" : "default",
                    background: prepareCount > 0 ? "rgba(120, 53, 15, 0.14)" : "#0f1629",
                    border: prepareCount > 0 ? "1px solid rgba(245, 158, 11, 0.5)" : "1px solid #1e2a3a",
                    borderRadius: 10,
                    padding: 16,
                    transition: "border-color 0.15s ease, transform 0.15s ease",
                  }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 15 }}>{account.name}</span>
                        {account.registered && <Tag color="blue" style={{ margin: 0 }}>Custom</Tag>}
                        {prepareCount > 0 && (
                          <Tag color="gold" style={{ margin: 0 }}>
                            {prepareCount} to sell · {formatCurrency(prepareValue)}
                          </Tag>
                        )}
                      </div>
                      {!hasHoldings && <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>No holdings yet</div>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {hasHoldings ?
                        <>
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            title="Rename / merge"
                            onClick={(e) => {
                              e.stopPropagation();
                              openRename(account);
                            }}
                          />
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.4 }}>Positions</div>
                            <div style={{ fontSize: 20, fontWeight: 800, color: "#e2e8f0" }}>{positions}</div>
                          </div>
                          <RightOutlined style={{ color: "#64748b", fontSize: 12 }} />
                        </>
                      : removable && (
                          <Popconfirm
                            title="Remove this asset?"
                            description="This only removes it from your asset list; campaigns are untouched."
                            onConfirm={() => handleDeleteAsset(account.assetId)}>
                            <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                          </Popconfirm>
                        )
                      }
                    </div>
                  </div>
                  {hasHoldings && (
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>Sellable Value</div>
                        <div style={{ fontWeight: 700, color: "#e2e8f0" }}>{formatCurrency(stats.currentValue)}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>P&L</div>
                        <PnLDisplay value={stats.pnl} percentage={stats.pnlPercent} size="small" />
                      </div>
                    </div>
                  )}
                </div>
              </Col>
            );
          })}
        </Row>
      </Card>

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
