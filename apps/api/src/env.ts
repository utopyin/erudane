import type * as Cloudflare from "alchemy/Cloudflare";
import type { Api } from "../../../alchemy.run.js";

export type ApiEnv = Cloudflare.InferEnv<typeof Api>;
