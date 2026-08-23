import * as Cloudflare from "cloudflare:workers";
import type { WebsiteEnv } from "../../../alchemy.run";

export const env = new Proxy({} as WebsiteEnv, {
  get(_, property) {
    return Cloudflare.env[property as keyof typeof Cloudflare.env];
  },
});
