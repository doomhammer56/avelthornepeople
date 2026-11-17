import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  // Keep visited public pages warm so back/forward and repeat clicks stay instant.
  experimental: {
    staleTimes: { dynamic: 30, static: 300 },
  },
  // Email links contain one-time credentials; never log their query strings.
  logging: { incomingRequests: { ignore: [/\/auth\/confirm(?:\?|$)/] } },
  // Compile Tailwind styles through the existing Turbopack loader.
  // Keep the project's stylesheet pipeline shared across public routes.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Register locale resolution without introducing backend services.
// Shared layouts use it to render the correct document language.
const withNextIntl = createNextIntlPlugin("./src/lib/i18n.ts");

export default withNextIntl(nextConfig);
