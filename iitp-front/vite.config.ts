import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import path from 'path'

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');

    return {
        server: {
            hmr: true,
            watch: {
                usePolling: true,
            },
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
