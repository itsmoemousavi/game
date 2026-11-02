/// <reference types="vitest" />
import { defineConfig } from 'vite';

// Relative base so the built bundle works inside a Capacitor (iOS/Android) WebView.
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify((process.env.GITHUB_SHA ?? 'dev').slice(0, 7)) },
  build: { target: 'es2020', outDir: 'dist', chunkSizeWarningLimit: 900 },
  // Full-match simulation tests are slow on shared CI machines.
  test: { testTimeout: 60000 },
});
