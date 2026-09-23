import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "development-refresh-csp",
      apply: "serve",
      transformIndexHtml(html) {
        // React Fast Refresh injects an inline bootstrap in development only.
        return html.replace(
          "script-src 'self'",
          "script-src 'self' 'unsafe-inline'",
        );
      },
    },
  ],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
