import { integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { table } from "../table";

export const files = table("files", {
  id: uuid().primaryKey(),
  key: text().notNull().unique(),
  mediaType: text().notNull(),
  fileName: text(),
  size: integer().notNull(),
  createdAt: timestamp({ withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
