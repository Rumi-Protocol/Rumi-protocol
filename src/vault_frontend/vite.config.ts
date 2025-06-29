import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  build: {
    // Ensure CSS gets properly handled
    cssCodeSplit: true,
    // Better handling for large WASM files
    target: 'esnext'
  },
  optimizeDeps: {
    esbuildOptions: {
      // Adds support for WASM inside dependencies
      target: 'esnext'
    }
  },
  ssr: {
    // Fix for the Internet Computer libraries that might use Node.js APIs
    noExternal: ['@dfinity/agent', '@dfinity/auth-client', '@dfinity/identity', '@dfinity/principal']
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
});



