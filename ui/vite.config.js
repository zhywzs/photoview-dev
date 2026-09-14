/// <reference types="vitest" />
/// <reference types="vite/client" />

import { defineConfig } from 'vite'
import svgr from 'vite-plugin-svgr'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), svgr()],
  envPrefix: ['VITE_', 'REACT_APP_'],
  server: {
    port: 1234,
    host: '0.0.0.0',
    // Proxy the API through the dev server so the UI and API share one
    // origin. This makes the app work on ANY host IP (localhost, LAN,
    // hotspot...) without CORS or cross-origin cookie issues.
    proxy: {
      '/api': {
        target: 'http://localhost:4001',
        changeOrigin: true,
        ws: true, // graphql subscriptions
      },
    },
  },
  esbuild: {
    logOverride: { 'this-is-undefined-in-esm': 'silent' },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './testing/setupTests.ts',
    reporters: ['verbose', 'junit'],
    outputFile: {
      junit: './junit-report.xml',
    },
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
  },
})