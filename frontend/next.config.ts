import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a self-contained server output under .next/standalone
  output: 'standalone',
  // Silence Next 16 warning when using a webpack() config by providing an empty turbopack config.
  // We explicitly force the webpack builder via --webpack in package.json.
  // This keeps our no-chunking webpack settings effective for production builds.
  turbopack: {},
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Disable code splitting/chunking - bundle everything into fewer files
      config.optimization.splitChunks = {
        cacheGroups: {
          default: false,
          vendors: false,
        },
      };
      config.optimization.runtimeChunk = false;
    }
    return config;
  },
};

export default nextConfig;
