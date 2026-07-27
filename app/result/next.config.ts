import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server for the Docker image.
  output: "standalone",
};

export default nextConfig;
