// layer/localLayerSchema.ts
export interface LocalLayerFieldSchema {
    type?: 'checkbox' | 'radio';
    url?: string;
    providers?: ['satellite', 'hybrid'];

}
const API_KEY = 'A6260B9D-ADEA-36CE-8000-4C4C57D4FCF5';
export const localLayerSchema: Record<string, LocalLayerFieldSchema> = {
    // VWorld는 예전에 http만 있었으나 https도 지원 — 반드시 https 사용. 페이지 자체가 HTTPS로
    // 서빙되는 배포 환경(개발서버)에서 http:// 타일 요청은 브라우저 Mixed Content 정책으로
    // 전부 차단돼("Failed to obtain image tile") 배경지도/Cesium 화면이 통째로 비어 보이는
    // 원인이었다.
    osm:        { type: 'radio', url: 'https://a.tile.thunderforest.com/transport-dark/{z}/{x}/{y}.png' },
    base:       { type: 'radio', url: `https://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/Base/{z}/{y}/{x}.png` },
    satellite:  { type: 'radio', url: `https://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/Satellite/{z}/{y}/{x}.jpeg` },
    hybrid:     { type: 'radio', url: `https://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/Hybrid/{z}/{y}/{x}.png`, providers: ['satellite', 'hybrid'] },
    midnight:   { type: 'radio', url: `https://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/midnight/{z}/{y}/{x}.png` },
    heatmap:    { type: 'checkbox' },
    trip:       { type: 'checkbox' },
    speed:      { type: 'checkbox' },
    traffic:    { type: 'checkbox' },
    od:         { type: 'checkbox' },
    facility1:  { type: 'checkbox' },
    facility2:  { type: 'checkbox' },
    facility3:  { type: 'checkbox' },
};
