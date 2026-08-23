import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Global request middleware: same-origin enforcement for state-changing requests. */
export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({ filter: ({ request }) => !SAFE_METHODS.has(request.method) }),
  ],
}));
