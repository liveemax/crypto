import { PHASE_PRODUCTION_BUILD } from "next/constants.js";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default (phase) => {
  if (phase === PHASE_PRODUCTION_BUILD && !process.env.RESEARCH_API_BASE_URL) {
    throw new Error(
      "RESEARCH_API_BASE_URL is required for a production build; fixture mode must not be deployed.",
    );
  }

  return nextConfig;
};
