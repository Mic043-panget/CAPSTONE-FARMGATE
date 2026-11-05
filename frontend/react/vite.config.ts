import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:8000',
                changeOrigin: false,
                secure: false,
                ws: true,
                configure: (proxy, options) => {
                    proxy.on('proxyReq', (proxyReq, req, res) => {
                        const origin = req.headers.origin || 'http://127.0.0.1:5173';
                        const referer = req.headers.referer || `${origin}/`;

                        // Preserve the active browser origin so Sanctum accepts the session on the actual dev-server port.
                        proxyReq.setHeader('Origin', origin);
                        proxyReq.setHeader('Referer', referer);
                    });
                },
            },
            '/sanctum': {
                target: 'http://127.0.0.1:8000',
                changeOrigin: false,
                secure: false,
                configure: (proxy, options) => {
                    proxy.on('proxyReq', (proxyReq, req, res) => {
                        const origin = req.headers.origin || 'http://127.0.0.1:5173';
                        const referer = req.headers.referer || `${origin}/`;

                        // Preserve the active browser origin so Sanctum accepts the CSRF cookie on the active dev port.
                        proxyReq.setHeader('Origin', origin);
                        proxyReq.setHeader('Referer', referer);
                    });
                },
            },
        },
    },
});