import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// O front (Vite) roda em :5173 e conversa com o BACKEND (projeto irmao em ../backend,
// Express em :3100) pelo proxy /api. Os dois rodam SEPARADOS, cada um no seu terminal:
//   ../backend > npm run dev     (sobe o Express em :3100)
//   ./         > npm run dev     (sobe o Vite em :5173, com este proxy)
// O navegador nunca fala com o backhomologa direto — quem faz isso e o Express (evita
// CORS e centraliza o token da sessao no servidor).
export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3100",
        changeOrigin: true,
        // SSE (rota de download) precisa fluir evento a evento. Sem buffer no
        // proxy, e sem timeout curto que corte um download longo de varias aulas.
        configure: proxy => {
          proxy.on("proxyReq", proxyReq => proxyReq.setHeader("X-Accel-Buffering", "no"));
        }
      }
    }
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true
  }
});
