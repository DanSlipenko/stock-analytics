'use client';

import React, { useState } from 'react';
import { Card, Button, Tag, Popconfirm, Modal, Form, InputNumber, Radio, Spin, message } from 'antd';
import { PlusOutlined, DeleteOutlined, BellOutlined } from '@ant-design/icons';
import { useStore } from '@/context/StoreContext';
import SymbolSearch from '@/components/shared/SymbolSearch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
        <Card className="data-table-card" bordered={false}>
          <Table aria-label="Price alerts" className="min-w-[760px] tabular-nums">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Symbol</TableHead>
                <TableHead scope="col">Condition</TableHead>
                <TableHead scope="col" className="text-right">Reference Price</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Created</TableHead>
                <TableHead scope="col" className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.alerts.map(alert => (
                <TableRow key={alert._id ?? `${alert.symbol}-${alert.createdAt}`}>
                  <TableCell className="font-bold">{alert.symbol}</TableCell>
                  <TableCell className={alert.type === 'above' ? 'text-green-500' : 'text-destructive'}>
                    {alert.type === 'above' ? 'Goes above' : 'Drops below'}{' '}
                    <strong>{alert.targetPrice != null ? `$${alert.targetPrice.toFixed(2)}` : `${alert.targetPercent}%`}</strong>
                  </TableCell>
                  <TableCell className="text-right">${alert.referencePrice.toFixed(2)}</TableCell>
                  <TableCell>{alert.triggered ? <Tag color="red">Triggered</Tag> : <Tag color="green">Active</Tag>}</TableCell>
                  <TableCell className="text-muted-foreground">{alert.createdAt ? new Date(alert.createdAt).toLocaleDateString() : '—'}</TableCell>
                  <TableCell className="text-right">
                    <Popconfirm title="Delete alert?" onConfirm={() => alert._id && handleDelete(alert._id)}>
                      <Button
                        type="text" danger icon={<DeleteOutlined />} size="small"
                        aria-label={`Delete ${alert.symbol} alert`}
                        style={{ width: 36, height: 36 }}
                      />
                    </Popconfirm>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
