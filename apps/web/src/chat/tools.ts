/**
 * Client-side view of the tool registry, derived from the same Effect `Tool`
 * definitions the server executes. Only types cross this seam: tools are
 * server-executed, the client needs their names and schemas to type
 * `ToolCallPart`s.
 */
import type { RegistryTool } from "@erudane/chat/types";
import { Registry } from "@erudane/http/chat/tools";
import { toolDefinition } from "@tanstack/ai/client";
import * as Schema from "effect/Schema";

/** Standard Schema (validation) + Standard JSON Schema (tool advertisement) from one Effect schema. */
const toStandard = <S extends Schema.Codec<any, any, never, never>>(schema: S) =>
  Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(schema));

const toClientTool = (tool: RegistryTool) =>
  toolDefinition({
    name: tool.name,
    description: tool.description ?? "",
    inputSchema: toStandard(tool.parametersSchema),
    outputSchema: toStandard(tool.successSchema),
  }).client();

export const tools = Object.values(Registry.toolkit.tools).map(toClientTool);
