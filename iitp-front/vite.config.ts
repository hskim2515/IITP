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
                '@primitives': path.resolve(__dirname, 'src/primitives'),
                '@stores': path.resolve(__dirname, 'src/stores'),
                '@schema': path.resolve(__dirname, 'src/schema'),
                '@utils': path.resolve(__dirname, 'src/utils'),
                '@adaptor': path.resolve(__dirname, 'src/adaptor'),
                '@managers': path.resolve(__dirname, 'src/managers'),
                '@features': path.resolve(__dirname, 'src/features'),
            }
        }
    };
});
