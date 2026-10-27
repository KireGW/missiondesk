import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  distDir: process.env.MISSIONDESK_LOCAL_PREVIEW === "true"
    ? process.env.MISSIONDESK_LOCAL_BUILD === "true" ? ".next-personal-build" : ".next-personal"
    : ".next",
};

export default nextConfig;
