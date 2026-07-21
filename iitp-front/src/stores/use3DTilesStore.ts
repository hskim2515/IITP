import { create } from "zustand";
import { createSelectors } from "@stores/createSelectors";
import * as Cesium from "cesium";

export interface TilesetEntry {
    id: number;
    label: string;
    sortOrder: number;
    urls: string[];
    enabled: boolean;
    tilesets?: Cesium.Cesium3DTileset[];
}

interface State {
    tilesets: TilesetEntry[];
    loaded: boolean;
}

interface Actions {
    fetchTilesets: () => Promise<void>;
    setTilesetEnabled: (id: number, enabled: boolean, viewer?: Cesium.Viewer) => void;
    createTileset: (label: string, urls: string[]) => Promise<void>;
    deleteTileset: (id: number) => Promise<void>;
    destroyAll: () => void;
}

const BASE_URL = import.meta.env.VITE_API_URL ?? '';
const BATCH_SIZE = 8; // 동시 로드 URL 수 제한

const TILESET_OPTIONS: Cesium.Cesium3DTileset.ConstructorOptions = {
    maximumScreenSpaceError: 32,       // 기본 16 → 32: 디테일 낮추되 속도 향상
    skipLevelOfDetail: true,           // LOD 단계 건너뛰기 → 빠른 초기 표시
    preferLeaves: true,                // 리프 노드 우선 로드
    dynamicScreenSpaceError: true,     // 원거리 타일 해상도 자동 감소
    dynamicScreenSpaceErrorDensity: 0.00278,
    dynamicScreenSpaceErrorFactor: 4.0,
    maximumMemoryUsage: 512,           // MB, 메모리 상한
};

async function loadUrlsInBatches(
    urls: string[],
    viewer: Cesium.Viewer,
): Promise<Cesium.Cesium3DTileset[]> {
    const results: Cesium.Cesium3DTileset[] = [];

    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
        const batch = urls.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
            batch.map(url =>
                Cesium.Cesium3DTileset.fromUrl(url, TILESET_OPTIONS)
                    .then(ts => {
                        viewer.scene.primitives.add(ts);
                        ts.show = true;
                        return ts;
                    })
                    .catch(e => {
                        console.error(`[3DTiles] 로드 실패: ${url}`, e);
                        return null;
                    })
            )
        );
        results.push(...batchResults.filter((ts): ts is Cesium.Cesium3DTileset => ts !== null));
    }

    return results;
}

const use3DTilesStoreBase = create<State & Actions>((set, get) => ({
    tilesets: [],
    loaded: false,

    fetchTilesets: async () => {
        try {
            const res = await fetch(`${BASE_URL}/threed-tileset`);
            if (!res.ok) return;
            const data: Array<{ id: number; label: string; sortOrder: number; urls: string[] }> = await res.json();
            set({
                loaded: true,
                tilesets: data.map(d => ({
                    id: d.id,
                    label: d.label,
                    sortOrder: d.sortOrder,
                    urls: d.urls ?? [],
                    enabled: false,
                })),
            });
        } catch (e) {
            console.error('[3DTiles] fetch 실패:', e);
        }
    },

    setTilesetEnabled: (id, enabled, viewer) => {
        set(state => ({
            tilesets: state.tilesets.map(t => {
                if (t.id !== id) return t;
                t.tilesets?.forEach(ts => { ts.show = enabled; });
                return { ...t, enabled };
            }),
        }));

        const entry = get().tilesets.find(t => t.id === id);
        if (!enabled || !viewer || !entry) return;

        if (!entry.tilesets || entry.tilesets.length === 0) {
            loadUrlsInBatches(entry.urls, viewer).then(loaded => {
                set(state => ({
                    tilesets: state.tilesets.map(t =>
                        t.id === id ? { ...t, tilesets: loaded } : t
                    ),
                }));
            });
        }
    },

    createTileset: async (label, urls) => {
        try {
            const sortOrder = get().tilesets.length;
            const res = await fetch(`${BASE_URL}/threed-tileset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label, sortOrder, urls }),
            });
            if (!res.ok) throw new Error(`등록 실패 (${res.status})`);
            const created: { id: number; label: string; sortOrder: number; urls: string[] } = await res.json();
            set(state => ({
                tilesets: [...state.tilesets, {
                    id: created.id, label: created.label, sortOrder: created.sortOrder,
                    urls: created.urls ?? [], enabled: false,
                }],
            }));
        } catch (e) {
            console.error('[3DTiles] 등록 실패:', e);
            throw e;
        }
    },

    deleteTileset: async (id) => {
        const entry = get().tilesets.find(t => t.id === id);
        // 로드돼 있던 Cesium3DTileset들은 씬에서 완전히 제거(destroy) — show=false 만으로는 GPU 메모리가 안 풀림
        entry?.tilesets?.forEach(ts => { if (!ts.isDestroyed()) ts.destroy(); });
        set(state => ({ tilesets: state.tilesets.filter(t => t.id !== id) }));
        try {
            const res = await fetch(`${BASE_URL}/threed-tileset/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error(`삭제 실패 (${res.status})`);
        } catch (e) {
            console.error('[3DTiles] 삭제 실패:', e);
            throw e;
        }
    },

    destroyAll: () => {
        get().tilesets.forEach(t => {
            t.tilesets?.forEach(ts => {
                if (!ts.isDestroyed()) ts.destroy();
            });
        });
        set(state => ({
            tilesets: state.tilesets.map(t => ({ ...t, enabled: false, tilesets: undefined })),
        }));
    },
}));

export const use3DTilesStore = createSelectors(use3DTilesStoreBase);
