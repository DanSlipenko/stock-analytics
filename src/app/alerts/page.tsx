'use client';

import React, { useState } from 'react';
import { Button, Popconfirm, Modal, Form, InputNumber, Radio, Spin, message } from 'antd';
import { PlusOutlined, DeleteOutlined, BellOutlined, ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { useStore } from '@/context/StoreContext';
import SymbolSearch from '@/components/shared/SymbolSearch';
import MetaLine from '@/components/shared/MetaLine';
import { formatUsd } from '@/lib/campaignFormat';
import { formatAlertDirection, formatAlertTarget } from '@/lib/alertFormat';
import { cn } from '@/lib/utils';
import { PriceAlert } from '@/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const formatCreated = (alert: PriceAlert) => (alert.createdAt ? new Date(alert.createdAt).toLocaleDateString() : '—');

function AlertCondition({ alert }: { alert: PriceAlert }) {
  return (
    <span className="alert-condition">
      {alert.type === 'above' ? <ArrowUpOutlined aria-hidden /> : <ArrowDownOutlined aria-hidden />}
      <span>
        {formatAlertDirection(alert.type)} <strong>{formatAlertTarget(alert)}</strong>
      </span>
    </span>
  );
}

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

  // Waiting alerts lead; ones that already fired get their own, quieter section.
  const activeAlerts = state.alerts.filter((alert) => !alert.triggered);
  const triggeredAlerts = state.alerts.filter((alert) => alert.triggered);

  const renderDeleteButton = (alert: PriceAlert) => (
    <Popconfirm title="Delete alert?" onConfirm={() => alert._id && handleDelete(alert._id)}>
      <Button
        type="text" danger icon={<DeleteOutlined />} size="small"
        aria-label={`Delete ${alert.symbol} alert`}
        style={{ width: 36, height: 36, flexShrink: 0 }}
      />
    </Popconfirm>
  );

  const renderAlerts = (alerts: PriceAlert[], label: string, inactive = false) => (
    <>
      <div className={cn('campaigns-panel desktop-table', inactive && 'campaigns-panel-inactive')}>
        <Table aria-label={label} className="min-w-[640px] tabular-nums">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Symbol</TableHead>
              <TableHead scope="col">Condition</TableHead>
              <TableHead scope="col" className="text-right">Reference Price</TableHead>
              <TableHead scope="col">Created</TableHead>
              <TableHead scope="col" className="text-right"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {alerts.map(alert => (
              <TableRow key={alert._id ?? `${alert.symbol}-${alert.createdAt}`}>
                <TableCell className="table-symbol">{alert.symbol}</TableCell>
                <TableCell><AlertCondition alert={alert} /></TableCell>
                <TableCell className="text-right">{formatUsd(alert.referencePrice)}</TableCell>
                <TableCell className="text-muted-foreground">{formatCreated(alert)}</TableCell>
                <TableCell className="text-right">{renderDeleteButton(alert)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className={cn('grouped-list mobile-list', inactive && 'grouped-list-inactive')} aria-label={label}>
        {alerts.map((alert) => (
          <li key={alert._id ?? `${alert.symbol}-${alert.createdAt}`} className="grouped-list-row">
            <div className="grouped-list-main">
              <span className="grouped-list-title">{alert.symbol}</span>
              <AlertCondition alert={alert} />
              <MetaLine
                parts={[`Reference ${formatUsd(alert.referencePrice)}`, formatCreated(alert)]}
                className="grouped-list-subtitle"
              />
            </div>
            {renderDeleteButton(alert)}
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <div className="page-container campaigns-page campaigns-container">
      <div className="page-header">
        <h1>Price Alerts</h1>
        <Button type="primary" shape="round" size="large" icon={<PlusOutlined />} className="campaigns-primary-action" onClick={() => setAddModal(true)}>
          Create Alert
        </Button>
      </div>

      {state.alerts.length === 0 ? (
        <div className="empty-state">
          <BellOutlined className="empty-state-icon" />
          <p className="empty-state-text">No alerts set. Get notified when stocks hit your target prices.</p>
          <Button type="primary" shape="round" size="large" icon={<PlusOutlined />} className="campaigns-primary-action" onClick={() => setAddModal(true)}>
            Create Alert
          </Button>
        </div>
      ) : (
        <>
          {activeAlerts.length > 0 && (
            <section className="campaigns-section" aria-labelledby="active-alerts-title">
              <h2 id="active-alerts-title" className="campaigns-section-title">
                Active <span className="campaigns-section-count">{activeAlerts.length}</span>
              </h2>
              {renderAlerts(activeAlerts, 'Active price alerts')}
            </section>
          )}

          {triggeredAlerts.length > 0 && (
            <section className="campaigns-section" aria-labelledby="triggered-alerts-title">
              <h2 id="triggered-alerts-title" className="campaigns-section-title">
                Triggered <span className="campaigns-section-count">{triggeredAlerts.length}</span>
              </h2>
              {renderAlerts(triggeredAlerts, 'Triggered price alerts', true)}
            </section>
          )}
        </>
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
