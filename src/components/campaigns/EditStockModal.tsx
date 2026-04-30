"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Modal, Form, InputNumber, DatePicker, Select, Space, Button, message, Divider, List, Typography } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { Campaign, CampaignStock } from "@/types";
import { useStore } from "@/context/StoreContext";
import dayjs from "dayjs";

interface EditStockModalProps {
  open: boolean;
  onClose: () => void;
  campaign: Campaign;
  stock: CampaignStock | null;
  onEditTransaction: (stock: CampaignStock, transaction: any) => void;
}

export default function EditStockModal({ open, onClose, campaign, stock, onEditTransaction }: EditStockModalProps) {
  const [form] = Form.useForm();
  const { dispatch } = useStore();
  const [loading, setLoading] = useState(false);

  const locationOptions = useMemo(() => {
    return campaign.moneyLocations.map((loc) => ({
      label: `${loc.name} ($${loc.allocatedAmount.toLocaleString()})`,
      value: loc._id,
    }));
  }, [campaign.moneyLocations]);

  useEffect(() => {
    if (stock && open) {
      form.setFieldsValue({
        shares: stock.shares,
        buyPrice: stock.buyPrice,
        buyDate: stock.buyDate ? dayjs(stock.buyDate) : null,
        locationId: stock.locationId,
      });
    }
  }, [stock, open, form]);

  const handleSubmit = async () => {
    if (!stock) return;

    try {
      const values = await form.validateFields();
      setLoading(true);

      const updatedStocks = campaign.stocks.map((s) => {
        if (s._id === stock._id) {
          return {
            ...s,
            shares: values.shares,
            buyPrice: values.buyPrice,
            buyDate: values.buyDate?.toISOString() || stock.buyDate,
            locationId: values.locationId || null,
          };
        }
        return s;
      });

      const res = await fetch(`/api/campaigns/${campaign._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stocks: updatedStocks }),
      });

      if (res.ok) {
        const updated = await res.json();
        dispatch({ type: "UPDATE_CAMPAIGN", payload: updated });
        form.resetFields();
        onClose();
        message.success(`Updated ${stock.symbol} details`);
      }
    } catch (e) {
      console.error("Edit stock error:", e);
    } finally {
      setLoading(false);
    }
  };

  if (!stock) return null;

  return (
    <Modal
      title={<span style={{ fontSize: 18, fontWeight: 600 }}>Edit {stock.symbol}</span>}
      open={open}
      onCancel={onClose}
      footer={null}
      width={480}
      destroyOnClose>
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="shares" label="Number of Shares" rules={[{ required: true, message: "Enter number of shares" }]}>
          <InputNumber placeholder="e.g. 10" style={{ width: "100%" }} size="large" min={0.0001} step={1} />
        </Form.Item>

        <Form.Item name="buyPrice" label="Buy Price (per share)" rules={[{ required: true, message: "Enter buy price per share" }]}>
          <InputNumber placeholder="e.g. 150.00" style={{ width: "100%" }} size="large" prefix="$" min={0} step={0.01} />
        </Form.Item>

        <Form.Item name="buyDate" label="Buy Date">
          <DatePicker style={{ width: "100%" }} size="large" />
        </Form.Item>

        {locationOptions.length > 0 && (
          <Form.Item name="locationId" label="Money Location">
            <Select placeholder="Select where this stock is held" options={locationOptions} size="large" allowClear />
          </Form.Item>
        )}

        {stock.transactions && stock.transactions.length > 0 && (
          <>
            <Divider orientation="left" style={{ margin: '24px 0 12px' }}>
              <span style={{ fontSize: 14, color: '#64748b' }}>Sell Transactions</span>
            </Divider>
            <List
              size="small"
              dataSource={stock.transactions}
              renderItem={(t: any) => (
                <List.Item
                  actions={[
                    <Button 
                      key="edit" 
                      type="text" 
                      size="small" 
                      icon={<EditOutlined />} 
                      onClick={() => onEditTransaction(stock, t)}
                    >
                      Edit Date
                    </Button>
                  ]}
                >
                  <List.Item.Meta
                    title={<Typography.Text strong>{new Date(t.date).toLocaleDateString()}</Typography.Text>}
                    description={`Sold ${t.shares} @ $${t.price}`}
                  />
                </List.Item>
              )}
              style={{ background: '#0f1629', borderRadius: 8, border: '1px solid #1e2a3a', padding: '0 8px' }}
            />
          </>
        )}

        <Space style={{ width: "100%", justifyContent: "flex-end", marginTop: 8 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" onClick={handleSubmit} loading={loading}>
            Save Changes
          </Button>
        </Space>
      </Form>
    </Modal>
  );
}
