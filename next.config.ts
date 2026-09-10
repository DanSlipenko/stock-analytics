import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Without this, Next sees
  // ~/package-lock.json and resolves modules against the home directory,
  // which breaks the dev bundle ("require is not defined").
  turbopack: {
    root: __dirname,
  },
  // Allow the phone / other LAN devices to load dev resources over the network URL.
  allowedDevOrigins: ['192.168.1.220'],
};

export default nextConfig;
