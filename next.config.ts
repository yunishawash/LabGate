import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained .next/standalone build — what the Dockerfile copies.
  // See SPEC §19.2.
  output: "standalone",

  // LAN devices (phones, tablets on the plant network) reaching the dev server.
  // Read from the environment rather than hardcoded, so the app carries no
  // host-specific values (SPEC §16).
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
};

export default nextConfig;
