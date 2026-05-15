import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['experiments-meeting-forgotten-celebrity.trycloudflare.com', 'nine-forks-remain.loca.lt'],
  devIndicators: {
    appIsrStatus: false,
    buildActivity: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
