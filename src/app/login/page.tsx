"use client";

import React, { Suspense, useState } from "react";
import { Button, Card, Form, Input } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = searchParams.get("next");
  // Only same-origin paths, so the login page can't be used as an open redirect.
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/campaigns";

  const handleSubmit = async ({ password }: { password: string }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // Full reload so the store provider refetches with the new session cookie.
        window.location.assign(destination);
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Sign-in failed");
    } catch {
      setError("Couldn't reach the server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card style={{ width: "100%", maxWidth: 360 }}>
      <div className="sidebar-brand" style={{ padding: 0, border: 0, marginBottom: 20 }}>
        <div className="sidebar-brand-icon">S</div>
        <span className="sidebar-brand-text">Finances</span>
      </div>
      <Form layout="vertical" onFinish={handleSubmit} requiredMark={false}>
        <Form.Item
          name="password"
          label="Password"
          validateStatus={error ? "error" : undefined}
          help={error ?? undefined}
          rules={[{ required: true, message: "Enter your password" }]}>
          <Input.Password prefix={<LockOutlined />} size="large" autoFocus autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" size="large" block loading={loading}>
          Sign in
        </Button>
      </Form>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
