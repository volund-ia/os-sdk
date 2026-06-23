import { defineConfig } from "tsdown";

// Bundler de biblioteca (Rolldown). Gera ESM + CJS + .d.ts/.d.cts num comando.
// Espelha o que o @cursor/sdk faz: declarações self-contained, sem deps de build.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  treeshake: true,
  sourcemap: true,
  // Deps em package.json são auto-externalizadas (eventsource-parser não é embutido).
});
