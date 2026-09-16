import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Lets `next dev` access Cloudflare bindings (KV judgment cache) locally.
initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {};

export default nextConfig;
