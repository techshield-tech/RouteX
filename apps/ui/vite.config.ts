import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// The backend binds ROUTEX_API_ADDR, which now defaults to 127.0.0.1:8090
// precisely so it doesn't collide with the seed listener `lst-http-main`,
// which binds 0.0.0.0:8080. Override with VITE_API_PROXY_TARGET if the
// server runs elsewhere.
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8090'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
})
