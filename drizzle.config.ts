import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

// drizzle-kit only auto-loads `.env`, but this project keeps its secrets in
// `.env.local` (gitignored). Without this, `db:push` would silently target the
// fallback local file instead of the configured database.
if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

export default defineConfig({
  dialect: "turso",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL ?? "file:./local.db",
    // An empty string in .env.local would fail drizzle-kit's parameter checks,
    // and local file databases do not take a token at all.
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  },
});
