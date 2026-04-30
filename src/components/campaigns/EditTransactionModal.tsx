"use client";

import React, { useEffect, useState } from "react";
import { Modal, Form, InputNumber, DatePicker, Space, Button, message } from "antd";
import { Campaign, CampaignStock } from "@/types";
import { useStore } from "@/context/StoreContext";
import dayjs from "dayjs";

interface EditTransactionModalProps {
  open: boolean;
  onClose: () => void;
  campaign: Campaign;
  stock: CampaignStock | null;
  transaction: any | null;
}

export default function EditTransactionModal({ open, onClose, campaign, stock, transaction }: EditTransactionModalProps) {
  const [form] = Form.useForm();
  const { dispatch } = useStore();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (transaction && open) {
      form.setFieldsValue({
        shares: transaction.shares,
        price: transaction.price,
        date: transaction.date ? dayjs(transaction.date) : dayjs(),
      });
    }
  }, [transaction, open, form]);

  const handleSubmit = async () => {
    if (!stock || !transaction) return;

    try {
      const values = await form.validateFields();
      setLoading(true);

      const updatedStocks = campaign.stocks.map((s) => {
        if (s._id === stock._id) {
          return {
            ...s,
            transactions: s.transactions.map((t: any) => {
              if (t._id === transaction._id) {
                return {
                  ...t,
                  shares: values.shares,
                  price: values.price,
                  date: values.date ? values.date.toISOString() : t.date,
                };
              }
              return t;
            }),
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
        message.success(`Updated transaction details`);
      } else {
        message.error("Failed to update transaction");
      }
    } catch (e) {
      console.error("Edit transaction error:", e);
    } finally {
      setLoading(false);
    }
  };

  if (!transaction || !stock) return null;

  return (
    <Modal
      title={<span style={{ fontSize: 18, fontWeight: 600 }}>Edit {stock.symbol} Sale</span>}
      open={open}
      onCancel={onClose}
      footer={null}
      width={400}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="shares" label="Shares Sold" rules={[{ required: true, message: "Enter shares" }]}>
          <InputNumber style={{ width: "100%" }} size="large" min={0.0001} step={1} />
        </Form.Item>

        <Form.Item name="price" label="Sell Price (per share)" rules={[{ required: true, message: "Enter price" }]}>
          <InputNumber style={{ width: "100%" }} size="large" prefix="$" min={0} step={0.01} />
        </Form.Item>

        <Form.Item name="date" label="Sell Date" rules={[{ required: true, message: "Select date" }]}>
          <DatePicker style={{ width: "100%" }} size="large" />
        </Form.Item>

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
