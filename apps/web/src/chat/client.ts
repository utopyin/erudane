import { fetchServerSentEvents } from "@tanstack/ai-react";
import { tools } from "./tools";

/** `useChat` options shared by every chat surface. */
export const chatOptions = {
  connection: fetchServerSentEvents("/api/chat"),
  tools,
} as const;
