import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.app.github.dev"],
  experimental: {
    serverActions: {
      bodySizeLimit: "11mb",
      allowedOrigins: [
        "*.app.github.dev",
        ...(process.env.NODE_ENV === "development" ? ["localhost:3000"] : []),
      ],
    },
  },
};

export default nextConfig;
