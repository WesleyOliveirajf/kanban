import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://localhost:3000" } },
  build: {
    // Vercel serve CDN a partir de public/; express.static é ignorado na plataforma.
    outDir: "../public",
    emptyOutDir: true,
  },
});
