import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import path from 'path'

export default defineConfig({
    server: {
        hmr: true,
        watch: {
            usePolling: true, // 파일 변경 감지 방식을 Polling으로 강제
        },
    },
    define: {
        global: 'globalThis'
    },
    plugins: [react(), cesium()],
    resolve: {
        alias: {
            '@primitives': path.resolve(__dirname, 'src/primitives'),
            '@stores': path.resolve(__dirname, 'src/stores'),
        }
    }
})