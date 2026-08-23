import { pgTableCreator } from "drizzle-orm/pg-core";
import { PREFIX } from "./config.js";

/** The only table factory the schema may use: `table("threads")` → `eru_threads`, snake_case columns. */
export const table = pgTableCreator((name) => `${PREFIX}_${name}`, "snake_case");
