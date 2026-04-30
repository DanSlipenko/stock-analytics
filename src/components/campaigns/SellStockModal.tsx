'use client';

import React, { useState, useMemo } from 'react';
import { Modal, Form, InputNumber, Slider, Space, Button, Statistic, Card, Row, Col, message, DatePicker } from 'antd';
import { CampaignStock, Campaign } from '@/types';
import { useStore } from '@/context/StoreContext';
import { useStockQuote } from '@/hooks/useStockQuote';
import dayjs from 'dayjs';

interface SellStockModalProps {
  open: boolean;
  onClose: () => void;
  campaign: Campaign;
  stock: CampaignStock | null;
}

export default function SellStockModal({ open, onClose, campaign, stock }: SellStockModalProps) {
  const [form] = Form.useForm();
  const { dispatch } = useStore();
  const [loading, setLoading] = useState(false);
  const [sellPercent, setSellPercent] = useState(100);
  const { quote } = useStockQuote(stock?.symbol || null);

  // Calculate remaining shares after previous sells
  const remainingShares = useMemo(() => {
    if (!stock) return 0;
    const soldShares = stock.transactions.reduce((sum, t) => sum + t.shares, 0);
    return stock.shares - soldShares;
  }, [stock]);

  const sharesToSell = useMemo(() => {
    return Math.round((remainingShares * sellPercent) / 100 * 10000) / 10000;
  }, [remainingShares, sellPercent]);

  const sellPrice = Form.useWatch('sellPrice', form) || quote?.currentPrice || 0;

  const projectedGain = useMemo(() => {
    if (!stock) return 0;
    return sharesToSell * (sellPrice - stock.buyPrice);
  }, [stock, sharesToSell, sellPrice]);

  const handleSubmit = async () => {
    if (!stock) return;

    try {
      const values = await form.validateFields();
      setLoading(true);

      const transaction = {
        type: 'sell' as const,
        shares: sharesToSell,
        price: values.sellPrice,
        date: values.sellDate ? values.sellDate.toISOString() : new Date().toISOString(),
        percentSold: sellPercent,
      };

      const updatedStocks = campaign.stocks.map((s) => {
        if (s._id === stock._id) {
          return { ...s, transactions: [...s.transactions, transaction] };
        }
        return s;
      });

      const res = await fetch(`/api/campaigns/${campaign._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stocks: updatedStocks }),
      });

      if (res.ok) {
        const updated = await res.json();
        dispatch({ type: 'UPDATE_CAMPAIGN', payload: updated });
        form.resetFields();
        setSellPercent(100);
        onClose();
        message.success(`Sold ${sharesToSell} shares of ${stock.symbol}`);
      }
    } catch (e) {
      console.error('Sell stock error:', e);
    } finally {
      setLoading(false);
    }
  };

  if (!stock) return null;

  return (
    <Modal
      title={<span style={{ fontSize: 18, fontWeight: 600 }}>Sell {stock.symbol}</span>}
      open={open}
      onCancel={onClose}
      footer={null}
      width={500}
      destroyOnClose
    >
      <Card
        size="small"
        style={{ marginTop: 16, marginBottom: 20, background: '#0f1629', border: '1px solid #1e2a3a' }}
      >
        <Row gutter={16}>
          <Col span={8}>
            <Statistic
              title={<span style={{ color: '#64748b', fontSize: 11 }}>Available</span>}
              value={remainingShares}
              suffix="shares"
              valueStyle={{ fontSize: 16, color: '#e2e8f0' }}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title={<span style={{ color: '#64748b', fontSize: 11 }}>Buy Price</span>}
              value={stock.buyPrice}
              prefix="$"
              precision={2}
              valueStyle={{ fontSize: 16, color: '#e2e8f0' }}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title={<span style={{ color: '#64748b', fontSize: 11 }}>Current</span>}
              value={quote?.currentPrice || 0}
              prefix="$"
              precision={2}
              valueStyle={{ fontSize: 16, color: '#00d4aa' }}
            />
          </Col>
        </Row>
      </Card>

      <Form form={form} layout="vertical" initialValues={{ sellPrice: quote?.currentPrice || 0, sellDate: dayjs() }}>
        <Form.Item label={`Sell Percentage — ${sellPercent}% (${sharesToSell} shares)`}>
          <Slider
            value={sellPercent}
            onChange={(v) => setSellPercent(v)}
            min={1}
            max={100}
            marks={{ 25: '25%', 50: '50%', 75: '75%', 100: '100%' }}
            tooltip={{ formatter: (v) => `${v}%` }}
          />
        </Form.Item>

        <Form.Item
          name="sellPrice"
          label="Sell Price (per share)"
          rules={[{ required: true, message: 'Enter sell price' }]}
        >
          <InputNumber
            style={{ width: '100%' }}
            size="large"
            prefix="$"
            min={0}
            step={0.01}
          />
        </Form.Item>

        <Form.Item name="sellDate" label="Sell Date" rules={[{ required: true, message: 'Select sell date' }]}>
          <DatePicker style={{ width: '100%' }} size="large" />
        </Form.Item>

        {/* Projected P&L */}
        <Card
          size="small"
          style={{
            marginBottom: 20,
            background: projectedGain >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${projectedGain >= 0 ? '#22c55e30' : '#ef444430'}`,
          }}
        >
          <Statistic
            title={<span style={{ color: '#94a3b8', fontSize: 12 }}>Projected Realized P&L</span>}
            value={projectedGain}
            prefix={projectedGain >= 0 ? '+$' : '-$'}
            precision={2}
            valueStyle={{
              fontSize: 22,
              color: projectedGain >= 0 ? '#22c55e' : '#ef4444',
              fontWeight: 700,
            }}
          />
        </Card>

        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="primary"
            onClick={handleSubmit}
            loading={loading}
            danger={projectedGain < 0}
          >
            Sell {sharesToSell} Shares
          </Button>
        </Space>
      </Form>
    </Modal>
  );
}
