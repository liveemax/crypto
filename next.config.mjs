/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack(config, { dev }) {
    // next lint loads the production phase too. Keep the deployment guard in
    // compilation so offline linting remains possible while a real build can
    // never silently ship fixture data.
    if (!dev && !process.env.RESEARCH_API_BASE_URL) {
      throw new Error(
        "RESEARCH_API_BASE_URL is required for a production build; fixture mode must not be deployed.",
      );
    }
    return config;
  },
};

export default nextConfig;
