'use client';

import React, { useState } from 'react';
import { Card, Button, Table, Tag, Popconfirm, Modal, Form, InputNumber, Select, Radio, Empty, Spin, message } from 'antd';
import { PlusOutlined, DeleteOutlined, BellOutlined } from '@ant-design/icons';
import { useStore } from '@/context/StoreContext';
import { useStockQuote } from '@/hooks/useStockQuote';
import SymbolSearch from '@/components/shared/SymbolSearch';

export default function AlertsPage() {
  const { state, dispatch } = useStore();
  const [addModal, setAddModal] = useState(false);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('');

  const thresholdType = Form.useWatch('thresholdType', form) || 'price';

  const handleAdd = async () => {
    try {
      const values = await form.validateFields();
      if (!selectedSymbol) { message.error('Select a symbol'); return; }

      // Get current price to set as reference
      const resPrice = await fetch(`/api/stock/quote?symbol=${selectedSymbol}`);
      const quoteData = await resPrice.json();
      const currentPrice = quoteData.currentPrice || 0;

      setLoading(true);
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: selectedSymbol,
          type: values.direction,
          targetPrice: thresholdType === 'price' ? values.targetValue : undefined,
          targetPercent: thresholdType === 'percent' ? values.targetValue : undefined,
          referencePrice: currentPrice,
        }),
      });

      if (res.ok) {
        const item = await res.json();
        dispatch({ type: 'ADD_ALERT', payload: item });
        form.resetFields();
        setSelectedSymbol('');
        setAddModal(false);
        message.success('Alert created');
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/alerts/${id}`, { method: 'DELETE' });
      if (res.ok) { dispatch({ type: 'DELETE_ALERT', payload: id }); message.success('Alert deleted'); }
    } catch (e) { console.error(e); }
  };

  if (state.loading) return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}><Spin size="large" /></div>;

  const columns = [
    { title: 'Symbol', dataIndex: 'symbol', key: 'symbol', render: (s: string) => <span style={{ fontWeight: 700 }}>{s}</span> },
    {
      title: 'Condition', key: 'condition',
      render: (_: unknown, record: { type: string; targetPrice?: number; targetPercent?: number }) => (
        <span style={{ color: record.type === 'above' ? '#22c55e' : '#ef4444' }}>
          {record.type === 'above' ? 'Goes above' : 'Drops below'}{' '}
          <strong>{record.targetPrice != null ? `$${record.targetPrice.toFixed(2)}` : `${record.targetPercent}%`}</strong>
        </span>
      ),
    },
    { title: 'Reference Price', dataIndex: 'referencePrice', key: 'ref', render: (v: number) => `$${v.toFixed(2)}` },
    { title: 'Status', key: 'status', render: (_: unknown, record: { triggered: boolean }) => (
      record.triggered ? <Tag color="red">Triggered</Tag> : <Tag color="green">Active</Tag>
    ) },
    { title: 'Created', dataIndex: 'createdAt', key: 'date', render: (d: string) => <span style={{ color: '#94a3b8' }}>{new Date(d).toLocaleDateString()}</span> },
    {
      title: '', key: 'actions', width: 80,
      render: (_: unknown, record: { _id?: string }) => (
        <Popconfirm title="Delete alert?" onConfirm={() => handleDelete(record._id!)}>
          <Button type="text" danger icon={<DeleteOutlined />} size="small" />
        </Popconfirm>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Price Alerts</h1>
        <Button type="primary" icon={<PlusOutlined />} size="large" onClick={() => setAddModal(true)}>Create Alert</Button>
      </div>

      {state.alerts.length === 0 ? (
        <div className="empty-state">
          <BellOutlined className="empty-state-icon" />
          <p className="empty-state-text">No alerts set. Get notified when stocks hit your target prices.</p>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModal(true)}>Create Alert</Button>
        </div>
      ) : (
        <Card bordered={false}>
          <Table
            dataSource={state.alerts.map((a) => ({ ...a, key: a._id }))}
            columns={columns}
            pagination={false}
          />
        </Card>
      )}

      <Modal title="Create Price Alert" open={addModal} onCancel={() => setAddModal(false)} footer={null} destroyOnClose width={480}>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }} initialValues={{ thresholdType: 'price', direction: 'above' }}>
          <Form.Item label="Stock Symbol" required>
            <SymbolSearch onSelect={(s) => setSelectedSymbol(s)} />
          </Form.Item>
          
          <Form.Item name="direction" label="Alert me when the price...">
            <Radio.Group>
              <Radio.Button value="above">Goes Above</Radio.Button>
              <Radio.Button value="below">Drops Below</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item name="thresholdType" label="Target Type">
            <Radio.Group>
              <Radio value="price">Fixed Price ($)</Radio>
              <Radio value="percent">Percentage (%)</Radio>
            </Radio.Group>
          </Form.Item>

          <Form.Item name="targetValue" label="Value" rules={[{ required: true, message: 'Enter target value' }]}>
            <InputNumber 
              prefix={thresholdType === 'price' ? '$' : ''} 
              suffix={thresholdType === 'percent' ? '%' : ''} 
              style={{ width: '100%' }} size="large" min={0.01} step={0.1} 
            />
          </Form.Item>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24 }}>
            <Button onClick={() => setAddModal(false)}>Cancel</Button>
            <Button type="primary" onClick={handleAdd} loading={loading}>Create Alert</Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
