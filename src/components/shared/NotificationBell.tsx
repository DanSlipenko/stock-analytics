'use client';

import React from 'react';
import { Badge, Dropdown, Empty, List, Typography } from 'antd';
import { BellOutlined } from '@ant-design/icons';
import { useStore } from '@/context/StoreContext';

const { Text } = Typography;

export default function NotificationBell() {
  const { state } = useStore();
  const count = state.triggeredAlerts.length;

  const menu = (
    <div
      style={{
        background: '#1a2332',
        borderRadius: 12,
        border: '1px solid #1e2a3a',
        width: 340,
        maxHeight: 400,
        overflow: 'auto',
        padding: '8px 0',
      }}
    >
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #1e2a3a' }}>
        <Text strong style={{ color: '#e2e8f0', fontSize: 14 }}>Notifications</Text>
      </div>
      {count === 0 ? (
        <Empty
          description={<Text style={{ color: '#64748b' }}>No notifications</Text>}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          style={{ padding: '24px 0' }}
        />
      ) : (
        <List
          dataSource={state.triggeredAlerts}
          renderItem={(alert) => {
            const direction = alert.type === 'above' ? '📈' : '📉';
            const threshold = alert.targetPrice != null
              ? `$${alert.targetPrice.toFixed(2)}`
              : `${alert.targetPercent}%`;

            return (
              <List.Item style={{ padding: '10px 16px', borderBottom: '1px solid #162030' }}>
                <div>
                  <div style={{ fontSize: 13, color: '#e2e8f0' }}>
                    {direction} <strong>{alert.symbol}</strong> crossed {threshold}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {alert.createdAt ? new Date(alert.createdAt).toLocaleString() : ''}
                  </div>
                </div>
              </List.Item>
            );
          }}
        />
      )}
    </div>
  );

  return (
    <Dropdown
      popupRender={() => menu}
      trigger={['click']}
      placement="bottomRight"
    >
      <div
        className="notification-badge"
        style={{ cursor: 'pointer', padding: '4px 8px', display: 'flex', alignItems: 'center' }}
      >
        <Badge count={count} size="small" offset={[-2, 2]}>
          <BellOutlined style={{ fontSize: 20, color: '#94a3b8' }} />
        </Badge>
      </div>
    </Dropdown>
  );
}
