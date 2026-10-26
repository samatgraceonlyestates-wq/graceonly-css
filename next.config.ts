import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cPanel runs a Node app from a startup file, which `next start` is not. Standalone output
  // is a self-contained server (.next/standalone/server.js plus the node_modules it traces);
  // deploy/app.js is the startup file, and scripts/build-standalone.mjs copies in what the
  // standalone output leaves out (.next/static, public). See docs/DEPLOY.md.
  output: "standalone",
  cacheComponents: false,
  // BEHIND A PROXY. Next refuses a server action (every form: sign-in, arrivals, corrections)
  // whose Origin does not match the Host (or X-Forwarded-Host) it receives. If the host's proxy
  // (LiteSpeed) passes the browser's Host through, they match and this is not needed; if it
  // rewrites Host to the app's own address and does not send X-Forwarded-Host, EVERY form fails
  // with a 500 ("Invalid Server Actions request"). Naming the public address here keeps CSS
  // working either way. Proven by scripts/shots-tls.ts. A change of domain must change this
  // line and be rebuilt (it is read at build time).
  experimental: {
    serverActions: { allowedOrigins: ["frontdesk.graceonlyestates.com"] },
  },
  partialPrefetching: false,
};

export default nextConfig;
