import type { ApiEnv } from "./env.js";
import { runtime } from "./runtime.js";

export default {
  fetch: (request: Request, env: ApiEnv): Promise<Response> => runtime(env).handler(request),
};
