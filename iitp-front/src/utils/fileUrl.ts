/**
 * REACT_APP_FILE_BASE_URL + filePath를 결합합니다.
 * - 개발: base="/file-proxy", Vite proxy가 실제 파일 서버로 전달 (mixed content 회피)
 * - 예) base="/file-proxy"  path="/models/a.glb"  →  "/file-proxy/models/a.glb"
 */
export function buildFileUrl(filePath: string | null | undefined): string {
    if (!filePath) return '';
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath;
    const base = (process.env.REACT_APP_FILE_BASE_URL ?? '').replace(/\/+$/, '');
    const path = filePath.replace(/^\/+/, '');
    return `${base}/${path}`;
}
