// Telegram's in-app browser can keep stale HTML, so pages and API responses are never cached.
// Hashed files under /_next/static keep Next's default long-lived caching.
const noStore = [
  { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" },
  { key: "Pragma", value: "no-cache" },
  { key: "Expires", value: "0" }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      { source: "/", headers: noStore },
      { source: "/:path((?!_next/static|_next/image|favicon.ico).*)", headers: noStore }
    ];
  }
};

export default nextConfig;
