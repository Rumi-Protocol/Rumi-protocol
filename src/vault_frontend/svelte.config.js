import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import path from 'path';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess({
    typescript: true,
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  }),
  kit: {
    adapter: adapter({
      pages: "dist",
      assets: "dist",
      fallback: "index.html",
      precompress: true,
      strict: true,
    }),
    files: {
      assets: "static",
    },
    alias: {
      '$declarations': '../declarations',
      '$lib': path.resolve('./src/lib'),
      '$services': path.resolve('./src/lib/services'),
      '$components': path.resolve('./src/lib/components'),
      '$stores': path.resolve('./src/lib/stores'),
      '$utils': path.resolve('./src/lib/utils')
    },
  }
};
export default config;