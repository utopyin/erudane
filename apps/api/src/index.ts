import type { ApiEnv } from "./env";
import { runtime } from "./runtime";

export default {
  fetch: (request: Request, env: ApiEnv): Promise<Response> => runtime(env).handler(request),
};
