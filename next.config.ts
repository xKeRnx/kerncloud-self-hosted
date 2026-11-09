import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: [
    "pg",
    "@modelcontextprotocol/sdk",
    "stripe",
    "pdf-parse",
    "fflate",
    "pdfkit",
    "@fontsource/noto-sans",
  ],
};
export default config;
