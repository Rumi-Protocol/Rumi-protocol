import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';


export default defineConfig({
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



