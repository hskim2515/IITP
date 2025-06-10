// layer/localLayerSchema.ts
export interface LocalLayerFieldSchema {
    type?: 'checkbox' | 'radio';
    url?: string;
    providers?: ['satellite', 'hybrid'];

}
const API_KEY = 'A6260B9D-ADEA-36CE-8000-4C4C57D4FCF5';
export const localLayerSchema: Record<string, LocalLayerFieldSchema> = {
    osm:        { type: 'radio', url: 'https://a.tile.thunderforest.com/transport-dark/{z}/{x}/{y}.png' },
    base:       { type: 'radio', url: `http://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/Base/{z}/{y}/{x}.png` },
    satellite:  { type: 'radio', url: `http://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/Satellite/{z}/{y}/{x}.jpeg` },
    hybrid:     { type: 'radio', url: `http://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/Hybrid/{z}/{y}/{x}.png`, providers: ['satellite', 'hybrid'] },
    midnight:     { type: 'radio', url: `http://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/midnight/{z}/{y}/{x}.png` },
    heatmap:    { type: 'checkbox' },
    trip:       { type: 'checkbox' },
    od:         { type: 'checkbox' },
    facility1:  { type: 'checkbox' },
    facility2:  { type: 'checkbox' },
    facility3:  { type: 'checkbox' },
};
