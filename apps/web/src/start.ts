import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

/** Global request middleware: same-origin enforcement for mutating requests. */
export const startInstance = createStart(() => ({
  requestMiddleware: [createCsrfMiddleware()],
}));
