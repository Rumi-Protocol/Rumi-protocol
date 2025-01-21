import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

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
 
  }
};
export default config;
