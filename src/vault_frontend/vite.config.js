import environment from 'vite-plugin-environment';
import dotenv from 'dotenv';
import * as path from 'path'; // Import the full module
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';

dotenv.config({ path: '../../.env' });

export default defineConfig({
  build: {
    
    emptyOutDir: true,
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4943",
        changeOrigin: true,
      },
    },
  },
  publicDir: "static",
  plugins: [
    environment("all", { prefix: "CANISTER_" }),
    environment("all", { prefix: "DFX_" }),
    sveltekit()
  ],
  resolve: {
    alias: [
      {
        '@dfinity/agent': path.resolve(__dirname, 'node_modules/@dfinity/agent'),
        find: "declarations",
        replacement: fileURLToPath(
          new URL("../declarations", import.meta.url)
        ),
      },
    ],
  },
});