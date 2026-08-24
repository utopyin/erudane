import { defineConfig } from "drizzle-kit";
import { MIGRATIONS_TABLE, PREFIX } from "./config";

const url = process.env.DATABASE_URL ?? "";

export default defineConfig({
  dialect: "postgresql",
  schema: "./schema.ts",
  out: "./migrations",
  tablesFilter: [`${PREFIX}_*`],
  migrations: { table: MIGRATIONS_TABLE, schema: "public" },
  dbCredentials: { url },
  verbose: true,
});
