/**
 * Tool definitions owned by the chat domain.
 *
 * LEAF MODULE: imports only `effect`. Never import `./service` or `./handlers`
 * from here — the web app imports this module to type its client tools.
 */
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

export const CurrentTime = Tool.make("CurrentTime", {
  description:
    "Returns the current UTC date and time as an ISO-8601 string. Use for anything time-relative.",
  success: Schema.Struct({ iso: Schema.String }),
  failureMode: "return",
});

export const toolkit = Toolkit.make(CurrentTime);

export * as ChatTools from "./tools";
