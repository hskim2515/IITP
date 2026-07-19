import { create } from 'zustand';
import { createSelectors } from "@stores/createSelectors";

export interface LayerField {
    id: number
    key: string;
    label: string;
    formType?: 'checkbox' | 'radio';
    basic: boolean;
    auth: number;
    providers?: ['satellite', 'hybrid'];
    url?: string
}

export interface LayerGroup {
    id: number;
    key: string;
    label: string;
    layers: LayerField[];
}

interface State {
    groups: LayerGroup[];
    loading: boolean;
}

interface Actions {
    fetchLayerSchema: () => Promise<void>;
}

const initialState = {
    groups: [] as LayerGroup[],
    loading: false,
};

export const useLayerSchemaStore = createSelectors(create<State & Actions>(
        ((set, get) => ({
            ...initialState,
            fetchLayerSchema: async () => {
                const {groups} = get();
                if (groups.length > 0) {
                    // 이미 한 번 로드됐으면 재진입 막기
                    return;
                }
                set({loading: true});
                try {
                    const res = await fetch(import.meta.env.VITE_API_URL + '/layer/group'); // fetch 사용
                    if (!res.ok) {
                        throw new Error('Network response was not ok');
                    }
                    const data: LayerGroup[] = await res.json(); // 응답을 JSON으로 파싱
                    const enrichedGroups = mapWithLocalSchema(data); // API 데이터와 localLayerSchema 매핑
                    set({groups: enrichedGroups, loading: false});
                } catch (error) {
                    console.error('Failed to fetch layer schema:', error);
                    set({loading: false});
                }
            },
        }))
    )
);

// API 데이터를 localLayerSchema와 매핑하여 확장
function mapWithLocalSchema(groupsFromApi: LayerGroup[]): LayerGroup[] {
    return groupsFromApi.map(group => {
        return ({
            ...group,
            fields: group.layers.map(layer => ({
                ...layer,
                //...localLayerSchema[layer.key], // UI 속성 추가
            })),
        })
    });
}