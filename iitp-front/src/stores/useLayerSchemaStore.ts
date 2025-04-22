import { create } from 'zustand';
import { localLayerSchema, LocalLayerFieldSchema } from '@schema/layerSchema';

export interface LayerField {
    key: string;
    label: string;
    type?: 'checkbox' | 'radio';
    basic: boolean;
    auth: number;
    providers?: ['satellite', 'hybrid'];
}

export interface LayerGroup {
    key: string;
    label: string;
    fields: LayerField[];
}

interface LayerSchemaState {
    groups: LayerGroup[];
    loading: boolean;
    fetchLayerSchema: () => Promise<void>;
}

export const useLayerSchemaStore = create<LayerSchemaState>((set) => ({
    groups: [],
    loading: false,
    fetchLayerSchema: async () => {
        set({ loading: true });
        try {
            const res = await fetch(import.meta.env.VITE_API_URL + '/layers/group'); // fetch 사용
            console.log(res)
            if (!res.ok) {
                throw new Error('Network response was not ok');
            }
            const data: LayerGroup[] = await res.json(); // 응답을 JSON으로 파싱
            console.log(data)
            const enrichedGroups = mapWithLocalSchema(data); // API 데이터와 localLayerSchema 매핑
            set({ groups: enrichedGroups, loading: false });
        } catch (error) {
            console.error('Failed to fetch layer schema:', error);
            set({ loading: false });
        }
    },
}));

// API 데이터를 localLayerSchema와 매핑하여 확장
function mapWithLocalSchema(groupsFromApi: LayerGroup[]): LayerGroup[] {
    return groupsFromApi.map(group => ({
        ...group,
        fields: group.layers.map(layer => ({
            ...layer,
            ...localLayerSchema[layer.key], // UI 속성 추가
        })),
    }));
}
