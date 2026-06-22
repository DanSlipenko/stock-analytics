"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Modal, Form, Input, InputNumber, DatePicker, Select, Space, Button, message } from "antd";
import SymbolSearch from "../shared/SymbolSearch";
import { Campaign, CampaignStock } from "@/types";
import { useStore } from "@/context/StoreContext";
import { assetOptions, institutionOf, resolveAssetLocation } from "@/lib/assets";

interface AddStockModalProps {
  open: boolean;
  onClose: () => void;
  campaign: Campaign;
  stock?: CampaignStock | null;
}

export default function AddStockModal({ open, onClose, campaign, stock }: AddStockModalProps) {
  const [form] = Form.useForm();
  const { state, dispatch } = useStore();
  const [loading, setLoading] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const isAddingToExistingStock = Boolean(stock);

  const assetChoices = useMemo(
    () => assetOptions(state.campaigns, state.assets.map((a) => a.name)).map((name) => ({ label: name, value: name })),
    [state.campaigns, state.assets],
  );

  useEffect(() => {
    if (open && stock) {
      setSelectedSymbol(stock.symbol);
      const location = campaign.moneyLocations.find((loc) => loc._id === stock.locationId);
      form.setFieldsValue({ asset: location ? institutionOf(location) : undefined });
    }

    if (!open) {
      form.resetFields();
      setSelectedSymbol("");
    }
  }, [form, open, stock, campaign.moneyLocations]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();

      if (!selectedSymbol) {
        message.error("Please select a stock symbol");
        return;
      }

      setLoading(true);

      const { locationId, moneyLocations } =
        values.asset ? resolveAssetLocation(campaign, values.asset) : { locationId: null, moneyLocations: campaign.moneyLocations };

      const newStock = {
        symbol: selectedSymbol,
        shares: values.shares,
        buyPrice: values.buyPrice,
        buyDate: values.buyDate?.toISOString() || new Date().toISOString(),
        locationId,
        transactions: [],
      };

      const updatedStocks = [...campaign.stocks, newStock];

      const res = await fetch(`/api/campaigns/${campaign._id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stocks: updatedStocks, moneyLocations }),
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

        <Form.Item name="asset" label="Asset" rules={[{ required: true, message: "Pick which asset holds this stock" }]}>
          <Select
            placeholder="Select an asset"
            options={assetChoices}
            size="large"
            showSearch
            optionFilterProp="label"
          />
        </Form.Item>

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
