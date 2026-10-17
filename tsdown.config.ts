import { defineConfig, type UserConfig } from "tsdown";

const config: UserConfig = defineConfig({
  entry: "src/index.ts",
  platform: "neutral",
  format: "esm",
  dts: true,
  target: "es2022",
  exports: true,
  clean: true,
  // Validate the package after each build.
  publint: true,
  attw: { profile: "esm-only", level: "error" },
});

export default config;
