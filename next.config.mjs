/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@libsql/client", "libsql", "unpdf"],
  // Read from disk at runtime (migrations, prompt files, mock-mode fixtures), so serverless bundles must include them.
  outputFileTracingIncludes: { "/**": ["./drizzle/**", "./prompts/**", "./fixtures/http/**"] },
  devIndicators: false,
  outputFileTracingIncludes: { "/**": ["./drizzle/**", "./prompts/**", "./fixtures/http/**"] },
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
