/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3", "unpdf"],
  devIndicators: false,
  webpack: (config, { dev }) => {
    if (dev) {
      // The SQLite file, recorded fixtures and test artifacts change while the app runs;
      // watching them would trigger rebuilds (and Fast Refresh remounts) on every database write.
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ["**/node_modules/**", "**/.git/**", "**/data/**", "**/fixtures/**", "**/e2e-artifacts/**", "**/prompts/**"],
      };
    }
    return config;
  },
};

export default nextConfig;
