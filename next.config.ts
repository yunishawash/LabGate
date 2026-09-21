import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained .next/standalone build — what the Dockerfile copies.
  // See SPEC §19.2.
  output: "standalone",

  // playwright-core ships non-JS assets (browsers.json etc.) that Node File
  // Trace does not pick up when the package is bundled — the standalone
  // build then fails at runtime with "Cannot find module browsers.json".
  // Marking it external makes Next copy the whole package into
  // .next/standalone/node_modules instead of tracing into it.
  serverExternalPackages: ["playwright-core"],

  // LAN devices (phones, tablets on the plant network) reaching the dev server.
  // Read from the environment rather than hardcoded, so the app carries no
  // host-specific values (SPEC §16).
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
};

export default nextConfig;
