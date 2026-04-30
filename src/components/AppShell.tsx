"use client";

import React, { useState } from "react";
import { Layout, Menu } from "antd";
import { DashboardOutlined, FolderOutlined, EyeOutlined, BellOutlined } from "@ant-design/icons";
import { usePathname, useRouter } from "next/navigation";
import NotificationBell from "@/components/shared/NotificationBell";
import { useAlertChecker } from "@/hooks/useAlertChecker";

const { Sider, Header, Content } = Layout;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Activate alert checking
  useAlertChecker();

  const menuItems = [
    {
      key: "/",
      icon: <DashboardOutlined />,
      label: "Dashboard",
    },
    {
      key: "/campaigns",
      icon: <FolderOutlined />,
      label: "Campaigns",
    },
    {
      key: "/watchlist",
      icon: <EyeOutlined />,
      label: "Watchlist",
    },
    {
      key: "/alerts",
      icon: <BellOutlined />,
      label: "Alerts",
    },
  ];

  const selectedKey = menuItems.find((item) => pathname === item.key || (item.key !== "/" && pathname.startsWith(item.key)))?.key || "/";

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={240}
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
          borderRight: "1px solid #1e2a3a",
        }}
        theme="dark">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">S</div>
          {!collapsed && <span className="sidebar-brand-text">StockPulse</span>}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => router.push(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout style={{ marginLeft: collapsed ? 80 : 240, transition: "margin-left 0.2s ease" }}>
        <Header
          style={{
            padding: "0 24px",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            borderBottom: "1px solid #1e2a3a",
            position: "sticky",
            top: 0,
            zIndex: 50,
          }}>
          <NotificationBell />
        </Header>
        <Content style={{ minHeight: "calc(100vh - 64px)" }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
