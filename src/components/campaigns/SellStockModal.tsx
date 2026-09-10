'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Modal, Form, InputNumber, Slider, Space, Button, Statistic, Card, Row, Col, message, DatePicker } from 'antd';
import { CampaignStock, Campaign } from '@/types';
import { useStore } from '@/context/StoreContext';
import { useStockQuote } from '@/hooks/useStockQuote';
import { formatShares, getRemainingShares, isSoldOut, sharesForPercent } from '@/lib/shares';
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
  const activeStockRef = useRef<string | null>(null);
  const priceAutoFilledRef = useRef(false);

  useEffect(() => {
    if (!open) {
      form.resetFields();
      setSellPercent(100);
      activeStockRef.current = null;
      priceAutoFilledRef.current = false;
      return;
    }

    if (!stock) return;

    const stockKey = stock._id ?? stock.symbol;

    if (activeStockRef.current !== stockKey) {
      activeStockRef.current = stockKey;
      priceAutoFilledRef.current = false;
      setSellPercent(100);
      form.setFieldsValue({
        sellDate: dayjs(),
        sellPrice: quote?.currentPrice ?? undefined,
      });

      if (quote?.currentPrice != null) {
        priceAutoFilledRef.current = true;
      }
      return;
    }

    if (!priceAutoFilledRef.current && quote?.currentPrice != null) {
      form.setFieldValue('sellPrice', quote.currentPrice);
      priceAutoFilledRef.current = true;
    }
  }, [open, stock, quote?.currentPrice, form]);

  // Calculate remaining shares after previous sells
  const remainingShares = useMemo(() => (stock ? getRemainingShares(stock) : 0), [stock]);

  const sharesToSell = useMemo(
    () => sharesForPercent(remainingShares, sellPercent),
    [remainingShares, sellPercent]
  );

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

      let clearedNotifications = false;
      const updatedStocks = campaign.stocks.map((s) => {
        if (s._id === stock._id) {
          const nextTransactions = [...s.transactions, transaction];
          const soldOut = isSoldOut({ ...s, transactions: nextTransactions });
          if (soldOut && (s.notifications?.length ?? 0) > 0) {
            clearedNotifications = true;
            return { ...s, transactions: nextTransactions, notifications: [] };
          }
          return { ...s, transactions: nextTransactions };
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
        message.success(
          clearedNotifications
            ? `Sold ${formatShares(sharesToSell)} shares of ${stock.symbol} — price alerts cleared`
            : `Sold ${formatShares(sharesToSell)} shares of ${stock.symbol}`,
        );
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
              value={formatShares(remainingShares)}
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
              valueStyle={{ fontSize: 16, color: '#f5f5f5' }}
            />
          </Col>
        </Row>
      </Card>

      <Form form={form} layout="vertical">
        <Form.Item label={`Sell Percentage — ${sellPercent}% (${formatShares(sharesToSell)} shares)`}>
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
            Sell {formatShares(sharesToSell)} Shares
          </Button>
        </Space>
      </Form>
    </Modal>
  );
}
