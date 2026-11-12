import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return {
      fallback: [
        {
          source: '/api/:path*',
          destination: `${process.env.API_URL ?? "http://localhost:4000"}/api/:path*`,
        },
      ],
    };
  },
  experimental: {
    proxyClientMaxBodySize: '100mb',
    proxyTimeout: 120_000,
  },
};

export default nextConfig;
