import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// En desarrollo el dashboard y la API comparten origen vía proxy: la cookie de
// sesión y el CSRF de Django funcionan sin configurar CORS.
const backend = process.env.BACKEND_URL || "http://localhost:8000";
const proxy = Object.fromEntries(["/api", "/admin", "/static"].map((path) => [path, { target: backend }]));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: "0.0.0.0", port: 5173, proxy },
  preview: { host: "0.0.0.0", port: 5173, proxy },
  build: {
    rollupOptions: {
      output: { manualChunks: { charts: ["recharts"], react: ["react", "react-dom", "react-router"] } },
    },
  },
});
