'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Modal, Tooltip, Typography } from 'antd';
import { DownloadOutlined, PlusSquareOutlined, ShareAltOutlined } from '@ant-design/icons';

const { Paragraph, Text } = Typography;

/* Not in lib.dom yet — Chromium-only, and the whole install flow hangs off it. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari predates display-mode and sets this instead.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  if (typeof window === 'undefined') return false;
  return (
    /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
    // iPadOS 13+ reports as a Mac; the touch points give it away.
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1)
  );
}

/**
 * "Install app" affordance for the header.
 *
 * Chromium fires `beforeinstallprompt`, which we stash and replay on click.
 * iOS has no such event, so we show the manual Add to Home Screen steps.
 * Renders nothing when the app is already installed or can't be.
 */
export default function InstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    setIos(isIos() && !isStandalone());

    const onBeforeInstallPrompt = (event: Event) => {
      // Suppress Chrome's mini-infobar so the header button is the entry point.
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);

    const displayMode = window.matchMedia('(display-mode: standalone)');
    const onDisplayModeChange = (event: MediaQueryListEvent) => setInstalled(event.matches);
    displayMode.addEventListener('change', onDisplayModeChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      displayMode.removeEventListener('change', onDisplayModeChange);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (ios && !deferredPrompt) {
      setShowIosHelp(true);
      return;
    }
    if (!deferredPrompt) return;

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    // The event is single-use; a dismissal means waiting for the next one.
    setDeferredPrompt(null);
    if (outcome === 'accepted') setInstalled(true);
  }, [deferredPrompt, ios]);

  if (installed) return null;
  if (!deferredPrompt && !ios) return null;

  return (
    <>
      <Tooltip title="Install StockPulse for offline access">
        <Button
          type="text"
          icon={<DownloadOutlined />}
          onClick={handleInstall}
          className="pwa-install-button"
          aria-label="Install app"
        >
          <span className="pwa-install-button-label">Install</span>
        </Button>
      </Tooltip>

      <Modal
        open={showIosHelp}
        onCancel={() => setShowIosHelp(false)}
        footer={null}
        centered
        title="Add StockPulse to your Home Screen"
      >
        <Paragraph style={{ color: '#94a3b8' }}>
          Safari installs web apps from the Share menu:
        </Paragraph>
        <ol style={{ color: '#e2e8f0', paddingLeft: 20, lineHeight: 2, margin: 0 }}>
          <li>
            Tap <ShareAltOutlined /> <Text strong>Share</Text> in the Safari toolbar.
          </li>
          <li>
            Scroll down and choose <PlusSquareOutlined />{' '}
            <Text strong>Add to Home Screen</Text>.
          </li>
          <li>
            Tap <Text strong>Add</Text> — StockPulse opens full screen from your Home Screen.
          </li>
        </ol>
      </Modal>
    </>
  );
}
