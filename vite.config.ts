import { defineConfig } from 'vite';

// Relative base so the built bundle works inside a Capacitor (iOS/Android) WebView.
export default defineConfig({
  base: './',
  build: { target: 'es2020', outDir: 'dist' },
});
