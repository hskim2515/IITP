export interface LayerField {
    value: string;
    label: string;
    type?: 'checkbox' | 'radio';
    providers?: ['satellite','hybrid'];
}

export interface LayerSchemaProps {
    label: string;        // 탭에 표시할 한글 레이블
    fields: LayerField[]; // 렌더링할 input 목록
}

export const layerSchema: Record<string, LayerSchemaProps> = {
    baseMap: {
        label: '배경지도',
        fields: [
            { value: 'osm',       label: 'OSM 지도',        type: 'radio' },
            { value: 'base',      label: 'VWorld 일반지도',  type: 'radio' },
            { value: 'satellite', label: 'VWorld 위성지도',  type: 'radio' },
            { value: 'hybrid',    label: 'VWorld Hybrid지도', type: 'radio', providers: ['satellite','hybrid']  },
        ],
    },
    layer: {
        label: '레이어',
        fields: [
            { value: 'heatmap', label: '히트맵 레이어', type: 'checkbox' },
            { value: 'trip',    label: '트립 레이어',   type: 'checkbox' },
        ],
    },
    facility: {
        label: '시설물',
        fields: [
            { value: 'facility1', label: '시설물 1', type: 'checkbox' },
            { value: 'facility2', label: '시설물 2', type: 'checkbox' },
            { value: 'facility3', label: '시설물 3', type: 'checkbox' },
        ],
    },
};
