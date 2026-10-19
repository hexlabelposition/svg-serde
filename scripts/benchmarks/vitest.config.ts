import { defineConfig, type ViteUserConfig } from "vitest/config";

const config: ViteUserConfig = defineConfig({
  test: {
    benchmark: {
      include: ["scripts/benchmarks/*.bench.ts"],
    },
  },
});

export default config;
