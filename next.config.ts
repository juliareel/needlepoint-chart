import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  // remove basePath and assetPrefix for root hosting
};

export default nextConfig;
