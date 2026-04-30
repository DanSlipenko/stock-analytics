"use client";

import React, { useEffect, useState } from "react";
import { Modal, Form, Input, Button, Space, Select, InputNumber, Divider, DatePicker } from "antd";
import { PlusOutlined, DeleteOutlined, BankOutlined } from "@ant-design/icons";
import { useStore } from "@/context/StoreContext";
import { Campaign, MoneyLocation } from "@/types";
import dayjs from "dayjs";

interface CreateCampaignModalProps {
  open: boolean;
  onClose: () => void;
  campaign?: Campaign | null;
}

type LocationInput = MoneyLocation;

export default function CreateCampaignModal({ open, onClose, campaign }: CreateCampaignModalProps) {
  const [form] = Form.useForm();
  const { dispatch } = useStore();
  const [loading, setLoading] = useState(false);
  const [locations, setLocations] = useState<LocationInput[]>([]);
  const isEditing = Boolean(campaign?._id);

  useEffect(() => {
    if (!open) return;

    form.setFieldsValue({
      name: campaign?.name ?? "",
      startDate: campaign?.startDate ? dayjs(campaign.startDate) : dayjs(),
    });
    setLocations(campaign?.moneyLocations ?? []);
  }, [campaign, form, open]);

  const addLocation = () => {
    setLocations([...locations, { name: "", type: "Fidelity Dan", allocatedAmount: 0 }]);
  };

  const removeLocation = (index: number) => {
    setLocations(locations.filter((_, i) => i !== index));
  };

  const updateLocation = <K extends keyof LocationInput>(index: number, field: K, value: LocationInput[K]) => {
    const updated = [...locations];
    updated[index] = { ...updated[index], [field]: value };
    setLocations(updated);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const res = await fetch(isEditing ? `/api/campaigns/${campaign?._id}` : "/api/campaigns", {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          startDate: values.startDate ? values.startDate.toISOString() : new Date().toISOString(),
          moneyLocations: locations.filter((l) => l.name.trim()),
        }),
      });

      if (res.ok) {
        const updatedCampaign = await res.json();
        dispatch({ type: isEditing ? "UPDATE_CAMPAIGN" : "ADD_CAMPAIGN", payload: updatedCampaign });
        form.resetFields();
        setLocations([]);
        onClose();
      }
    } catch (e) {
      console.error(`${isEditing ? "Update" : "Create"} campaign error:`, e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={<span style={{ fontSize: 18, fontWeight: 600 }}>{isEditing ? "Edit Campaign" : "Create New Campaign"}</span>}
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }} initialValues={{ startDate: dayjs() }}>
        <Form.Item
          name="name"
          label="Campaign Name"
          rules={[{ required: true, message: 'Please enter a campaign name' }]}
        >
          <Input placeholder="e.g. Q1 2026 Tech Portfolio" size="large" />
        </Form.Item>

        <Form.Item
          name="startDate"
          label="Start Date"
          rules={[{ required: true, message: 'Please select a start date' }]}
        >
          <DatePicker size="large" style={{ width: '100%' }} />
        </Form.Item>

        <Divider titlePlacement="start" style={{ color: '#94a3b8', fontSize: 13 }}>
          <BankOutlined /> Money Locations
        </Divider>

        {locations.map((loc, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 8,
              marginBottom: 12,
              padding: 12,
              background: '#0f1629',
              borderRadius: 8,
              border: '1px solid #1e2a3a',
            }}
          >
            <Input
              placeholder="Name (e.g. Fidelity)"
              value={loc.name}
              onChange={(e) => updateLocation(i, "name", e.target.value)}
              style={{ flex: 2 }}
            />
            <Select
              value={loc.type}
              onChange={(v) => updateLocation(i, "type", v)}
              style={{ flex: 1 }}
              options={[
                { label: "PayPal", value: "PayPal" },
                { label: "Kraken", value: "Kraken" },
                { label: "Fidelity Roth Clara", value: "Fidelity Roth Clara" },
                { label: "Fidelity Roth Dan", value: "Fidelity Roth Dan" },
                { label: "Fidelity Dan", value: "Fidelity Dan" },
                { label: "Charles Schwab", value: "Charles Schwab" },
              ]}
            />
            <InputNumber
              placeholder="Amount"
              value={loc.allocatedAmount}
              onChange={(v) => updateLocation(i, "allocatedAmount", v || 0)}
              prefix="$"
              style={{ flex: 1 }}
              min={0}
              formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
            />
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              onClick={() => removeLocation(i)}
            />
          </div>
        ))}

        <Button
          type="dashed"
          onClick={addLocation}
          icon={<PlusOutlined />}
          block
          style={{ marginBottom: 24 }}
        >
          Add Money Location
        </Button>

        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" onClick={handleSubmit} loading={loading}>
            {isEditing ? "Save Changes" : "Create Campaign"}
          </Button>
        </Space>
      </Form>
    </Modal>
  );
}
