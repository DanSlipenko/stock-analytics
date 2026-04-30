'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Card, Button, Table, Tag, Statistic, Row, Col, Spin, Empty, Space, Input, Select,
  InputNumber, message, Popconfirm, Divider, Segmented
} from 'antd';
import {
  PlusOutlined, ArrowLeftOutlined, BankOutlined, DeleteOutlined,
  DollarOutlined, TrophyOutlined, RiseOutlined, FallOutlined,
  LineChartOutlined, UnorderedListOutlined, AppstoreOutlined
} from '@ant-design/icons';
import { useRouter, useParams } from 'next/navigation';
import { useStore } from '@/context/StoreContext';
import { useStockQuotes } from '@/hooks/useStockQuote';
import { Campaign, CampaignStock, MoneyLocation } from '@/types';
import AddStockModal from '@/components/campaigns/AddStockModal';
import SellStockModal from '@/components/campaigns/SellStockModal';
import EditStockModal from '@/components/campaigns/EditStockModal';
import EditTransactionModal from '@/components/campaigns/EditTransactionModal';
import StockChart, { TimeRange, TIME_RANGES } from '@/components/charts/StockChart';
import StockDetailDrawer from '@/components/charts/StockDetailDrawer';
import PnLDisplay from '@/components/shared/PnLDisplay';
import { calculateCampaignStats } from '@/lib/campaignStats';

export default function CampaignDetailPage() {
  const router = useRouter();
  const params = useParams();
  const { state, dispatch } = useStore();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [addStockModal, setAddStockModal] = useState(false);
  const [buyMoreStock, setBuyMoreStock] = useState<CampaignStock | null>(null);
  const [sellStock, setSellStock] = useState<CampaignStock | null>(null);
  const [editStock, setEditStock] = useState<CampaignStock | null>(null);
  const [editTransaction, setEditTransaction] = useState<{ stock: CampaignStock; transaction: any } | null>(null);
  const [drawerSymbol, setDrawerSymbol] = useState<string | null>(null);

  // View mode
  const [viewMode, setViewMode] = useState<'list' | 'candlestick' | 'area'>('list');
  const [globalTimeRange, setGlobalTimeRange] = useState<TimeRange>('1Y');

  // Money location editing
  const [editingLocations, setEditingLocations] = useState(false);
  const [localLocations, setLocalLocations] = useState<MoneyLocation[]>([]);

  const campaignId = params.id as string;

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

  // Save money locations
  const saveLocations = useCallback(async () => {
    if (!campaign) return;
    try {
      const res = await fetch(`/api/campaigns/${campaign._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moneyLocations: localLocations }),
      });
      if (res.ok) {
        const updated = await res.json();
        dispatch({ type: 'UPDATE_CAMPAIGN', payload: updated });
        setCampaign(updated);
        setEditingLocations(false);
        message.success('Money locations updated');
      }
    } catch (e) {
      console.error('Save locations error:', e);
    }
  }, [campaign, localLocations, dispatch]);

  // Delete stock
  const deleteStock = useCallback(async (stockId: string) => {
    if (!campaign) return;
    const updatedStocks = campaign.stocks.filter((s) => s._id !== stockId);
    try {
      const res = await fetch(`/api/campaigns/${campaign._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stocks: updatedStocks }),
      });
      if (res.ok) {
        const updated = await res.json();
        dispatch({ type: 'UPDATE_CAMPAIGN', payload: updated });
        setCampaign(updated);
        message.success('Stock removed');
      }
    } catch (e) {
      console.error('Delete stock error:', e);
    }
  }, [campaign, dispatch]);

  // Calculate campaign stats
  const stats = useMemo(() => {
    return campaign ? calculateCampaignStats(campaign, quotes) : { invested: 0, currentValue: 0, realized: 0, pnl: 0, pnlPercent: 0 };
  }, [campaign, quotes]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="page-container">
        <Empty description="Campaign not found" />
        <Button onClick={() => router.push('/campaigns')} icon={<ArrowLeftOutlined />} style={{ marginTop: 16 }}>
          Back to Campaigns
        </Button>
      </div>
    );
  }

  const stockColumns = [
    {
      title: 'Symbol',
      dataIndex: 'symbol',
      key: 'symbol',
      render: (symbol: string) => (
        <Button
          type="link"
          style={{ fontWeight: 700, fontSize: 15, padding: 0 }}
          onClick={(e) => { e.stopPropagation(); setDrawerSymbol(symbol); }}
        >
          {symbol} <LineChartOutlined style={{ fontSize: 11 }} />
        </Button>
      ),
    },
    {
      title: 'Shares',
      key: 'shares',
      render: (_: unknown, record: CampaignStock) => {
        const sold = record.transactions.reduce((sum, t) => sum + t.shares, 0);
        const remaining = record.shares - sold;
        return (
          <span>
            {remaining.toLocaleString()}
            {sold > 0 && <span style={{ color: '#64748b', fontSize: 12 }}> / {record.shares}</span>}
          </span>
        );
      },
    },
    {
      title: 'Buy Price',
      dataIndex: 'buyPrice',
      key: 'buyPrice',
      render: (v: number) => `$${v.toFixed(2)}`,
      align: 'right' as const,
    },
    {
      title: 'Current',
      key: 'current',
      render: (_: unknown, record: CampaignStock) => {
        const price = quotes[record.symbol]?.currentPrice;
        return price ? `$${price.toFixed(2)}` : '—';
      },
      align: 'right' as const,
    },
    {
      title: 'Unrealized P&L',
      key: 'unrealized',
      render: (_: unknown, record: CampaignStock) => {
        const sold = record.transactions.reduce((sum, t) => sum + t.shares, 0);
        const remaining = record.shares - sold;
        const curPrice = quotes[record.symbol]?.currentPrice || record.buyPrice;
        const pnl = remaining * (curPrice - record.buyPrice);
        const pnlPct = ((curPrice - record.buyPrice) / record.buyPrice) * 100;
        return <PnLDisplay value={pnl} percentage={pnlPct} size="small" />;
      },
      align: 'right' as const,
    },
    {
      title: 'Realized',
      key: 'realized',
      render: (_: unknown, record: CampaignStock) => {
        const realized = record.transactions.reduce(
          (sum, t) => sum + t.shares * (t.price - record.buyPrice), 0
        );
        return realized !== 0 ? <PnLDisplay value={realized} size="small" /> : <span style={{ color: '#64748b' }}>—</span>;
      },
      align: 'right' as const,
    },
    {
      title: 'Location',
      key: 'location',
      render: (_: unknown, record: CampaignStock) => {
        const loc = campaign.moneyLocations.find((l) => l._id === record.locationId);
        return loc ? <Tag>{loc.name}</Tag> : <span style={{ color: '#64748b' }}>—</span>;
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: unknown, record: CampaignStock) => {
        const sold = record.transactions.reduce((sum, t) => sum + t.shares, 0);
        const hasRemaining = record.shares - sold > 0;
        return (
          <Space size="small">
            {hasRemaining && (
              <Button size="small" onClick={(e) => { e.stopPropagation(); setSellStock(record); }}>
                Sell
              </Button>
            )}
            <Button size="small" onClick={(e) => { e.stopPropagation(); setBuyMoreStock(record); }}>
              Buy More
            </Button>
            <Button size="small" type="text" onClick={(e) => { e.stopPropagation(); setEditStock(record); }}>
              Edit
            </Button>
            <Popconfirm
              title="Remove this stock?"
              onConfirm={(e) => { e?.stopPropagation(); deleteStock(record._id!); }}
              onCancel={(e) => e?.stopPropagation()}
            >
              <Button size="small" danger type="text" icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
            </Popconfirm>
          </Space>
        );
      },
      width: 220,
    },
  ];

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/campaigns')} type="text" />
          <h1>{campaign.name}</h1>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddStockModal(true)}>
          Add Stock
        </Button>
      </div>

      {/* Stats Row */}
      <div className="stats-grid animate-in">
        <Card className="stat-card" bordered={false}>
          <Statistic
            title={<span style={{ color: '#64748b' }}>Invested</span>}
            value={stats.invested}
            prefix={<DollarOutlined style={{ color: '#3b82f6' }} />}
            precision={2}
            valueStyle={{ color: '#e2e8f0' }}
            formatter={(v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          />
        </Card>
        <Card className="stat-card" bordered={false}>
          <Statistic
            title={<span style={{ color: '#64748b' }}>Current Value</span>}
            value={stats.currentValue}
            precision={2}
            valueStyle={{ color: '#e2e8f0' }}
            formatter={(v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          />
        </Card>
        <Card className="stat-card" bordered={false}>
          <Statistic
            title={<span style={{ color: '#64748b' }}>Total P&L</span>}
            prefix={stats.pnl >= 0 ? <RiseOutlined /> : <FallOutlined />}
            value={stats.pnl}
            precision={2}
            valueStyle={{ color: stats.pnl >= 0 ? '#22c55e' : '#ef4444' }}
            formatter={(v) => `${Number(v) >= 0 ? '+' : ''}$${Math.abs(Number(v)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          />
        </Card>
        <Card className="stat-card" bordered={false}>
          <Statistic
            title={<span style={{ color: '#64748b' }}>Realized Gains</span>}
            prefix={<TrophyOutlined style={{ color: '#f59e0b' }} />}
            value={stats.realized}
            precision={2}
            valueStyle={{ color: stats.realized >= 0 ? '#22c55e' : '#ef4444' }}
            formatter={(v) => `${Number(v) >= 0 ? '+' : ''}$${Math.abs(Number(v)).toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          />
        </Card>
      </div>

      {/* Money Locations */}
      <Card
        title={
          <span style={{ color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
            <BankOutlined /> Money Locations
          </span>
        }
        bordered={false}
        style={{ marginBottom: 24 }}
        extra={
          editingLocations ? (
            <Space>
              <Button onClick={() => { setLocalLocations(campaign.moneyLocations); setEditingLocations(false); }}>Cancel</Button>
              <Button type="primary" onClick={saveLocations}>Save</Button>
            </Space>
          ) : (
            <Button type="text" onClick={() => setEditingLocations(true)}>Edit</Button>
          )
        }
      >
        {editingLocations ? (
          <div>
            {localLocations.map((loc, i) => (
              <div
                key={loc._id || i}
                style={{
                  display: 'flex', gap: 8, marginBottom: 10, padding: 10,
                  background: '#0f1629', borderRadius: 8, border: '1px solid #1e2a3a',
                }}
              >
                <Input
                  value={loc.name}
                  onChange={(e) => {
                    const updated = [...localLocations];
                    updated[i] = { ...updated[i], name: e.target.value };
                    setLocalLocations(updated);
                  }}
                  placeholder="Name"
                  style={{ flex: 2 }}
                />
                <Select
                  value={loc.type}
                  onChange={(v) => {
                    const updated = [...localLocations];
                    updated[i] = { ...updated[i], type: v as MoneyLocation['type'] };
                    setLocalLocations(updated);
                  }}
                  style={{ flex: 1 }}
                  options={[
                    { label: 'PayPal', value: 'PayPal' },
                    { label: 'Kraken', value: 'Kraken' },
                    { label: 'Fidelity Roth Clara', value: 'Fidelity Roth Clara' },
                    { label: 'Fidelity Roth Dan', value: 'Fidelity Roth Dan' },
                    { label: 'Fidelity Dan', value: 'Fidelity Dan' },
                    { label: 'Charles Schwab', value: 'Charles Schwab' },
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
                  style={{ flex: 1 }}
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
              onClick={() => setLocalLocations([...localLocations, { name: '', type: 'Fidelity Dan', allocatedAmount: 0 }])}
              icon={<PlusOutlined />}
              block
            >
              Add Location
            </Button>
          </div>
        ) : campaign.moneyLocations.length === 0 ? (
          <Empty
            description={<span style={{ color: '#64748b' }}>No money locations. Click Edit to add.</span>}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          <Row gutter={16}>
            {campaign.moneyLocations.map((loc) => (
              <Col key={loc._id} xs={12} md={8} lg={6}>
                <Card size="small" style={{ background: '#0f1629', border: '1px solid #1e2a3a', marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>{loc.name}</div>
                  <Tag color="default" style={{ marginBottom: 4 }}>{loc.type}</Tag>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#00d4aa' }}>
                    ${loc.allocatedAmount.toLocaleString()}
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Card>

      {/* Stocks Area */}
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <span style={{ color: '#e2e8f0', display: 'flex', alignItems: 'center', gap: 12 }}>
              Stocks
              {campaign.stocks.length > 0 && viewMode !== 'list' && (
                <div className="time-range-group" style={{ marginLeft: 16 }}>
                  {TIME_RANGES.map((r) => (
                    <button
                      key={r.key}
                      className={`time-range-btn ${globalTimeRange === r.key ? 'active' : ''}`}
                      onClick={() => setGlobalTimeRange(r.key)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
            </span>
            <Space>
              <Segmented
                options={[
                  { value: 'list', icon: <UnorderedListOutlined /> },
                  { value: 'candlestick', icon: <AppstoreOutlined /> },
                  { value: 'area', icon: <LineChartOutlined /> },
                ]}
                value={viewMode}
                onChange={(v) => setViewMode(v as 'list' | 'candlestick' | 'area')}
              />
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddStockModal(true)}>
                Add Stock
              </Button>
            </Space>
          </div>
        }
        bordered={false}
      >
        {campaign.stocks.length === 0 ? (
          <Empty
            description={<span style={{ color: '#64748b' }}>No stocks in this campaign yet.</span>}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : viewMode === 'list' ? (
          <Table
            dataSource={campaign.stocks.map((s) => ({ ...s, key: s._id }))}
            columns={stockColumns}
            pagination={false}
            expandable={{
              expandedRowRender: (record: CampaignStock) => (
                <div style={{ padding: '8px 0' }}>
                  <Divider titlePlacement="start" style={{ color: '#64748b', fontSize: 12, margin: '0 0 12px 0' }}>
                    Transaction History
                  </Divider>
                  {record.transactions.length === 0 ? (
                    <span style={{ color: '#64748b', fontSize: 13 }}>No transactions yet</span>
                  ) : (
                    <Table
                      dataSource={record.transactions.map((t, i) => ({ ...t, key: i }))}
                      columns={[
                        { title: 'Date', dataIndex: 'date', render: (d: string) => new Date(d).toLocaleDateString() },
                        { title: 'Shares Sold', dataIndex: 'shares', render: (v: number) => v.toLocaleString() },
                        { title: 'Sell Price', dataIndex: 'price', render: (v: number) => `$${v.toFixed(2)}` },
                        { title: '% Sold', dataIndex: 'percentSold', render: (v: number) => `${v}%` },
                        {
                          title: 'Realized P&L',
                          key: 'pnl',
                          render: (_: unknown, t: { shares: number; price: number }) => {
                            const pnl = t.shares * (t.price - record.buyPrice);
                            return <PnLDisplay value={pnl} size="small" />;
                          },
                        },
                        {
                          title: 'Actions',
                          key: 'actions',
                          render: (_: unknown, transactionRecord: any) => (
                            <Button
                              size="small"
                              type="text"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditTransaction({ stock: record, transaction: transactionRecord });
                              }}
                            >
                              Edit
                            </Button>
                          ),
                          align: 'right' as const,
                        },
                      ]}
                      pagination={false}
                      size="small"
                    />
                  )}
                </div>
              ),
            }}
          />
        ) : (
          <Row gutter={[24, 24]}>
            {campaign.stocks.map((stock) => {
              const markers: import('lightweight-charts').SeriesMarker<import('lightweight-charts').Time>[] = [];
              
              if (stock.buyDate) {
                const d = new Date(stock.buyDate);
                const timeStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
                markers.push({
                  time: timeStr as unknown as import('lightweight-charts').Time,
                  position: 'belowBar',
                  color: '#22c55e',
                  shape: 'arrowUp',
                  text: `Buy @ $${stock.buyPrice}`,
                });
              }

              if (stock.transactions && stock.transactions.length > 0) {
                stock.transactions.forEach((t) => {
                  if (t.type === 'sell' && t.date) {
                    const d = new Date(t.date);
                    const timeStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
                    markers.push({
                      time: timeStr as unknown as import('lightweight-charts').Time,
                      position: 'aboveBar',
                      color: '#ef4444',
                      shape: 'arrowDown',
                      text: `Sell @ $${t.price}`,
                    });
                  }
                });
              }

              return (
                <Col key={stock._id} xs={24} lg={12}>
                  <div style={{ background: '#0f1629', borderRadius: 12, border: '1px solid #1e2a3a', overflow: 'hidden' }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid #1e2a3a', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 700, fontSize: 16, color: '#e2e8f0' }}>{stock.symbol}</span>
                      <Space size="small">
                        <Button size="small" type="text" onClick={() => setBuyMoreStock(stock)}>Buy More</Button>
                        <Button size="small" type="text" onClick={() => setEditStock(stock)}>Edit</Button>
                        <Button size="small" type="text" onClick={() => setSellStock(stock)}>Sell</Button>
                      </Space>
                    </div>
                    <StockChart
                      symbol={stock.symbol}
                      height={260}
                      hideToolbar
                      activeRangeOverride={globalTimeRange}
                      chartType={viewMode === 'area' ? 'area' : 'candlestick'}
                      markers={markers}
                    />
                  </div>
                </Col>
              );
            })}
          </Row>
        )}
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
      <SellStockModal
        open={!!sellStock}
        onClose={() => setSellStock(null)}
        campaign={campaign}
        stock={sellStock}
      />
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
      <StockDetailDrawer
        symbol={drawerSymbol}
        open={!!drawerSymbol}
        onClose={() => setDrawerSymbol(null)}
      />
    </div>
  );
}
