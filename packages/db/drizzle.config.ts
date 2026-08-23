import { defineConfig } from "drizzle-kit";
import { MIGRATIONS_TABLE, PREFIX } from "./config";

// @effect-diagnostics-next-line processEnv:off -- drizzle-kit CLI contract, not Effect code
const url = process.env.DATABASE_URL ?? "";

export default defineConfig({
  dialect: "postgresql",
  schema: "./schema.ts",
  out: "./migrations",
  tablesFilter: [`${PREFIX}_*`],
  migrations: { table: MIGRATIONS_TABLE },
  dbCredentials: { url },
  verbose: true,
});
