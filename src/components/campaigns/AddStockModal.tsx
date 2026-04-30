"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Modal, Form, Input, InputNumber, DatePicker, Select, Space, Button, message } from "antd";
import SymbolSearch from "../shared/SymbolSearch";
import { Campaign, CampaignStock } from "@/types";
import { useStore } from "@/context/StoreContext";

interface AddStockModalProps {
  open: boolean;
  onClose: () => void;
  campaign: Campaign;
  stock?: CampaignStock | null;
}

export default function AddStockModal({ open, onClose, campaign, stock }: AddStockModalProps) {
  const [form] = Form.useForm();
  const { dispatch } = useStore();
  const [loading, setLoading] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const isAddingToExistingStock = Boolean(stock);

  const locationOptions = useMemo(() => {
    return campaign.moneyLocations.map((loc) => ({
      label: `${loc.name} ($${loc.allocatedAmount.toLocaleString()})`,
      value: loc._id,
    }));
  }, [campaign.moneyLocations]);

  useEffect(() => {
    if (open && stock) {
      setSelectedSymbol(stock.symbol);
      form.setFieldsValue({ locationId: stock.locationId || undefined });
    }

    if (!open) {
      form.resetFields();
      setSelectedSymbol("");
    }
  }, [form, open, stock]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      if (!selectedSymbol) {
        message.error("Please select a stock symbol");
        return;
      }

      setLoading(true);

      const newStock = {
        symbol: selectedSymbol,
        shares: values.shares,
        buyPrice: values.buyPrice,
        buyDate: values.buyDate?.toISOString() || new Date().toISOString(),
        locationId: values.locationId || null,
        transactions: [],
      };

      const updatedStocks = [...campaign.stocks, newStock];

      const res = await fetch(`/api/campaigns/${campaign._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stocks: updatedStocks }),
      });

      if (res.ok) {
        const updated = await res.json();
        dispatch({ type: "UPDATE_CAMPAIGN", payload: updated });
        form.resetFields();
        setSelectedSymbol("");
        onClose();
        message.success(
          isAddingToExistingStock
            ? `Added ${values.shares} more shares of ${selectedSymbol}`
            : `Added ${selectedSymbol} to campaign`
        );
      }
    } catch (e) {
      console.error("Add stock error:", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={<span style={{ fontSize: 18, fontWeight: 600 }}>{stock ? `Buy More ${stock.symbol}` : "Add Asset"}</span>}
      open={open}
      onCancel={onClose}
      footer={null}
      width={480}
      destroyOnClose>
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        {stock ?
          <Form.Item label="Symbol">
            <Input value={stock.symbol} disabled size="large" />
          </Form.Item>
        : <Form.Item label="Symbol" required>
            <SymbolSearch
              onSelect={(symbol) => setSelectedSymbol(symbol)}
              placeholder="Search for a stock or crypto (e.g. AAPL, BINANCE:BTCUSDT)..."
            />
          </Form.Item>
        }

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

        <Space style={{ width: "100%", justifyContent: "flex-end", marginTop: 8 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" onClick={handleSubmit} loading={loading}>
            {stock ? "Add Purchase" : "Add Stock"}
          </Button>
        </Space>
      </Form>
    </Modal>
  );
}
