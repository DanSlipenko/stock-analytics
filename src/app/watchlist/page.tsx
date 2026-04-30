'use client';

import React, { useState, useMemo } from 'react';
import { Card, Button, Table, Tag, Empty, Spin, Modal, Form, InputNumber, Input, message, Popconfirm } from 'antd';
import { PlusOutlined, EyeOutlined, DeleteOutlined } from '@ant-design/icons';
import { useStore } from '@/context/StoreContext';
import { useStockQuotes } from '@/hooks/useStockQuote';
import SymbolSearch from '@/components/shared/SymbolSearch';
import StockDetailDrawer from '@/components/charts/StockDetailDrawer';
import PnLDisplay from '@/components/shared/PnLDisplay';

export default function WatchlistPage() {
  const { state, dispatch } = useStore();
  const [addModal, setAddModal] = useState(false);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [drawerSymbol, setDrawerSymbol] = useState<string | null>(null);

  const symbols = useMemo(() => state.watchlist.map((w) => w.symbol), [state.watchlist]);
  const { quotes } = useStockQuotes(symbols);

  const handleAdd = async () => {
    try {
      const values = await form.validateFields();
      if (!selectedSymbol) { message.error('Select a symbol'); return; }
      setLoading(true);
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: selectedSymbol, targetBuyPrice: values.targetBuyPrice, notes: values.notes || '' }),
      });
      if (res.ok) {
        const item = await res.json();
        dispatch({ type: 'ADD_WATCHLIST_ITEM', payload: item });
        form.resetFields();
        setSelectedSymbol('');
        setAddModal(false);
        message.success('Added to watchlist');
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/watchlist/${id}`, { method: 'DELETE' });
      if (res.ok) { dispatch({ type: 'DELETE_WATCHLIST_ITEM', payload: id }); message.success('Removed'); }
    } catch (e) { console.error(e); }
  };

  if (state.loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}><Spin size="large" /></div>;

  const columns = [
    {
      title: 'Symbol', dataIndex: 'symbol', key: 'symbol',
      render: (s: string) => (
        <Button type="link" style={{ fontWeight: 700, padding: 0 }} onClick={() => setDrawerSymbol(s)}>{s}</Button>
      ),
    },
    {
      title: 'Current Price', key: 'current',
      render: (_: unknown, record: { symbol: string }) => {
        const q = quotes[record.symbol];
        return q ? `$${q.currentPrice.toFixed(2)}` : '—';
      },
      align: 'right' as const,
    },
    {
      title: 'Target Buy', dataIndex: 'targetBuyPrice', key: 'target',
      render: (v: number) => <span style={{ color: '#00d4aa', fontWeight: 600 }}>${v.toFixed(2)}</span>,
      align: 'right' as const,
    },
    {
      title: 'Distance', key: 'distance',
      render: (_: unknown, record: { symbol: string; targetBuyPrice: number }) => {
        const q = quotes[record.symbol];
        if (!q) return '—';
        const dist = ((q.currentPrice - record.targetBuyPrice) / q.currentPrice) * 100;
        const atTarget = q.currentPrice <= record.targetBuyPrice;
        return atTarget
          ? <Tag color="green">🎯 At Target!</Tag>
          : <PnLDisplay value={-dist} percentage={-dist} showArrow={false} size="small" prefix="" />;
      },
      align: 'right' as const,
    },
    { title: 'Notes', dataIndex: 'notes', key: 'notes', render: (n: string) => <span style={{ color: '#94a3b8' }}>{n || '—'}</span> },
    {
      title: '', key: 'actions', width: 100,
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
        <Button type="primary" icon={<PlusOutlined />} size="large" onClick={() => setAddModal(true)}>Add Stock</Button>
      </div>

      {state.watchlist.length === 0 ? (
        <div className="empty-state">
          <EyeOutlined className="empty-state-icon" />
          <p className="empty-state-text">Your watchlist is empty. Add stocks you&apos;re waiting to buy.</p>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModal(true)}>Add to Watchlist</Button>
        </div>
      ) : (
        <Card bordered={false}>
          <Table
            dataSource={state.watchlist.map((w) => ({ ...w, key: w._id }))}
            columns={columns}
            pagination={false}
            rowClassName={(record) => {
              const q = quotes[record.symbol];
              return q && q.currentPrice <= record.targetBuyPrice ? 'gain' : '';
            }}
          />
        </Card>
      )}

      <Modal title="Add to Watchlist" open={addModal} onCancel={() => setAddModal(false)} footer={null} destroyOnClose width={440}>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="Stock Symbol" required>
            <SymbolSearch onSelect={(s) => setSelectedSymbol(s)} />
          </Form.Item>
          <Form.Item name="targetBuyPrice" label="Target Buy Price" rules={[{ required: true, message: 'Enter target price' }]}>
            <InputNumber prefix="$" style={{ width: '100%' }} size="large" min={0} step={0.01} />
          </Form.Item>
          <Form.Item name="notes" label="Notes">
            <Input.TextArea rows={2} placeholder="Why are you watching this stock?" />
          </Form.Item>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setAddModal(false)}>Cancel</Button>
            <Button type="primary" onClick={handleAdd} loading={loading}>Add</Button>
          </div>
        </Form>
      </Modal>

      <StockDetailDrawer symbol={drawerSymbol} open={!!drawerSymbol} onClose={() => setDrawerSymbol(null)} />
    </div>
  );
}
