import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  distDir: process.env.MISSIONDESK_LOCAL_PREVIEW === "true" ? ".next-personal" : ".next",
};

export default nextConfig;
