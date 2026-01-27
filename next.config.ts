import type { NextConfig } from "next";

const nextConfig = {
  output: "export",
  images: { unoptimized: true },
  basePath: "/needlepoint-chart",
  assetPrefix: "/needlepoint-chart/",
  env: {
    NEXT_PUBLIC_BASE_PATH: "/needlepoint-chart",
  },
};
export default nextConfig;
