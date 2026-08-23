import { defineConfig } from "oxlint";

export default defineConfig({
  ignorePatterns: ["repos", "**/routeTree.gen.ts"],
  rules: {
    "import/extensions": ["error", "never"],
  },
});
