"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Layout, Menu, Drawer, Button } from "antd";
import { DashboardOutlined, FolderOutlined, EyeOutlined, BellOutlined, WalletOutlined, MenuOutlined } from "@ant-design/icons";
import { usePathname, useRouter } from "next/navigation";
import NotificationBell from "@/components/shared/NotificationBell";
import RefreshButton from "@/components/shared/RefreshButton";
import InstallButton from "@/components/pwa/InstallButton";
import { useAlertChecker } from "@/hooks/useAlertChecker";

const { Sider, Header, Content } = Layout;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  // Activate alert checking
  useAlertChecker();

  const menuItems = [
    {
      key: "/campaigns",
      icon: <FolderOutlined />,
      label: "Campaigns",
    },
    {
      key: "/dashboard",
      icon: <DashboardOutlined />,
      label: "Dashboard",
    },
    {
      key: "/assets",
      icon: <WalletOutlined />,
      label: "Assets",
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

  const selectedKey =
    menuItems.find((item) => pathname === item.key || pathname.startsWith(`${item.key}/`))?.key ?? "/campaigns";

  const navigate = (key: string) => {
    router.push(key);
    setMobileNavOpen(false);
  };

  if (pathname === "/login") return <>{children}</>;

  return (
    <Layout className="app-shell" style={{ minHeight: "100vh" }}>
      <Sider
        className="app-sidebar"
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
        <div className="sidebar-brand !py-[13.5px]">
          <div className="sidebar-brand-icon">S</div>
          {!collapsed && <span className="sidebar-brand-text">Finances</span>}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout className="app-main-layout" style={{ marginLeft: collapsed ? 80 : 240, transition: "margin-left 0.2s ease" }}>
        <Header
          className="app-header"
          style={{
            padding: "0 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            position: "sticky",
            top: 0,
            zIndex: 50,
          }}>
          <div className="mobile-header-brand">
            <Button
              type="text"
              className="mobile-menu-trigger"
              aria-label="Open navigation menu"
              icon={<MenuOutlined />}
              onClick={() => setMobileNavOpen(true)}
            />
            <div className="sidebar-brand-icon">S</div>
            <span className="sidebar-brand-text">Finances</span>
          </div>
          <div className="app-header-actions">
            <InstallButton />
            <RefreshButton />
            <NotificationBell />
          </div>
        </Header>
        <Content className="app-content" style={{ minHeight: "calc(100vh - 64px)" }}>
          {children}
        </Content>
      </Layout>
      <Drawer
        className="mobile-nav-drawer"
        placement="left"
        size={288}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        closable={{ placement: "end" }}
        styles={{
          header: { background: "#0f1629", borderBottom: "none", paddingInline: "20px 16px" },
          body: { padding: "4px 12px calc(16px + env(safe-area-inset-bottom, 0px))", background: "#0f1629" },
        }}
        title={
          <div className="mobile-header-brand" style={{ display: "flex" }}>
            <div className="sidebar-brand-icon">S</div>
            <span className="sidebar-brand-text">Finances</span>
          </div>
        }>
        {/* Links rather than antd's Menu: this is site navigation, not a menu of commands. */}
        <nav aria-label="Primary">
          <ul className="mobile-nav-list">
            {menuItems.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.key}
                  className="mobile-nav-item"
                  aria-current={item.key === selectedKey ? "page" : undefined}
                  onClick={() => setMobileNavOpen(false)}>
                  {item.icon}
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Drawer>
    </Layout>
  );
}
