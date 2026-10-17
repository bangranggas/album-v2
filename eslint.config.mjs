import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

/**
 * eslint-config-next v16 ships flat config arrays directly, so no FlatCompat
 * layer is needed. `core-web-vitals` already includes the TypeScript rules.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "userscript/**",
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
];

export default config;
