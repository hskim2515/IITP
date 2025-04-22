import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import path from 'path'

export default defineConfig(({ mode }) => {
    // 해당 모드의 .env 파일 로드 (예: .env.development, .env.production 등)
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
            'process.env': env, // 이걸 추가하면 JS 코드에서 process.env.XXX 도 사용 가능
        },
        plugins: [react(), cesium()],
        resolve: {
            alias: {
                '@primitives': path.resolve(__dirname, 'src/primitives'),
                '@stores': path.resolve(__dirname, 'src/stores'),
                '@schema': path.resolve(__dirname, 'src/schema'),
            }
        }
    };
});
