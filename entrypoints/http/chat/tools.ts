/**
 * The tool registry: every domain's toolkit merged into one.
 *
 * LEAF MODULE: imports only `effect` and `<domain>/tools` leaves. The web app
 * imports this module to derive its client tool definitions, so it must never
 * reach a handler, a service, or a runtime.
 */
import { ChatTools } from "@erudane/chat/tools";
import { ResearchTools } from "@erudane/research/tools";
import { SubjectTools } from "@erudane/subjects/tools";
import * as Toolkit from "effect/unstable/ai/Toolkit";

export const toolkit = Toolkit.merge(
  ChatTools.toolkit,
  ResearchTools.toolkit,
  SubjectTools.toolkit,
);

export type Tools = typeof toolkit.tools;

export * as Registry from "./tools";
