/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strip the "X-Powered-By: Next.js" response header so we don't leak the
  // framework + version to clients/scanners.
  poweredByHeader: false,

  // Keep React Strict Mode on — it only adds dev-time double-invocation
  // checks (no production runtime cost) and helps surface effect bugs.
  reactStrictMode: true,

  // Don't emit source maps in the production browser bundle. Default is
  // already false; keeping it explicit so it can't be flipped accidentally.
  productionBrowserSourceMaps: false,

  // gzip/brotli compression of responses (default true, made explicit).
  compress: true,
};

export default nextConfig;

