/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// base: "./" keeps asset URLs relative so the same build works locally
// (vite preview) and under a GitHub Pages project subpath without rewrites.
export default defineConfig({
  plugins: [react()],
  base: "./",
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
