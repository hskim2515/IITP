import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import path from 'path'
import fs from 'fs'

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');

    const fileOrigin = env.REACT_APP_FILE_ORIGIN ?? '';

    return {
        server: {
            hmr: true,
            watch: {
                usePolling: true,
            },
            proxy: fileOrigin ? {
                '/file-proxy': {
                    target: fileOrigin,
                    changeOrigin: true,
                    selfHandleResponse: true,
                    rewrite: (p) => p.replace(/^\/file-proxy/, ''),
                    configure: (proxy) => {
                        proxy.on('proxyRes', (proxyRes, req, res) => {
                            // 원격 서버 오류 시 public/ 로컬 파일 fallback
                            if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
                                const localPath = (req.url ?? '').replace(/\?.*$/, '');
                                const filePath = path.join(__dirname, 'public', localPath);
                                if (fs.existsSync(filePath)) {
                                    res.writeHead(200);
                                    fs.createReadStream(filePath).pipe(res);
                                    return;
                                }
                            }
                            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
                            proxyRes.pipe(res);
                        });
                        proxy.on('error', (_err, req, res) => {
                            const localPath = ((req as any).url ?? '').replace(/\?.*$/, '');
                            const filePath = path.join(__dirname, 'public', localPath);
                            if (fs.existsSync(filePath)) {
                                (res as any).writeHead?.(200);
                                fs.createReadStream(filePath).pipe(res as any);
                                return;
                            }
                            (res as any).writeHead?.(502);
                            (res as any).end?.('Proxy error');
                        });
                    },
                },
            } : {},
        },
        define: {
            global: 'globalThis',
            'process.env': env,
        },
        plugins: [react(), cesium()],
        resolve: {
            alias: {
                '@api': path.resolve(__dirname, 'src/api'),
                '@adaptor': path.resolve(__dirname, 'src/adaptor'),
                '@assets': path.resolve(__dirname, 'src/assets'),
                '@component': path.resolve(__dirname, 'src/component'),
                '@config': path.resolve(__dirname, 'src/config'),
                '@datasource': path.resolve(__dirname, 'src/datasource'),
                '@features': path.resolve(__dirname, 'src/features'),
                '@interactions': path.resolve(__dirname, 'src/interactions'),
                '@handler': path.resolve(__dirname, 'src/handler'),
                '@hooks': path.resolve(__dirname, 'src/hooks'),
                '@managers': path.resolve(__dirname, 'src/managers'),
                '@primitives': path.resolve(__dirname, 'src/primitives'),
                '@schema': path.resolve(__dirname, 'src/schema'),
                '@stores': path.resolve(__dirname, 'src/stores'),
                '@type': path.resolve(__dirname, 'src/type'),
                '@utils': path.resolve(__dirname, 'src/utils'),
                '@worker': path.resolve(__dirname, 'src/worker'),
                '@css': path.resolve(__dirname, 'static/css'),
            }
        }
    };
});
