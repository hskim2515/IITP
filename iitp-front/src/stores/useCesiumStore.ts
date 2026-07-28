import { create } from "zustand";
import * as Cesium from "cesium";
import { Viewer } from "cesium";
import { createSelectors } from "@stores/createSelectors";
import { combine, subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import {useEventStore} from "@stores/useEventStore";
import {EventManager} from "@managers/EventManager";
import {CesiumEventAdapter} from "@adaptor/CesiumEventAdapter";

/** 자체 호스팅 지형 서버 (useMapInit 최초 Viewer 생성, 지형 토글 재활성화 양쪽에서 공유) */
export const CESIUM_TERRAIN_URL = 'https://lhdt.gaia3d.dev/terrain-tile/dem05_ellipsoid';

interface State {
    viewer: Viewer | null;
    terrainEnabled: boolean;
}

interface Actions {
    setViewer: (viewer: Viewer | null) => void;
    setTerrainEnabled: (enabled: boolean) => void;
}

const initialState: State = {
    viewer: null,
    terrainEnabled: true,
}

export const useCesiumStore = createSelectors(create<State & Actions>(
        subscribeWithSelector(
            immer(
                combine(initialState, (set) => ({
                        setViewer: (viewer) => {
                            if (!viewer) { set({ viewer }); return; }
                            const adapter = new CesiumEventAdapter(viewer);
                            const manager = new EventManager(adapter);
                            useEventStore.getState().setCesiumManager(manager);
                            set({ viewer })
                        },
                        // 지형 on/off — off 는 EllipsoidTerrainProvider(민 타원체)로 즉시 전환,
                        // on 은 지형 서버에서 다시 fromUrl 로드(비동기). 기존 코드 전반(NetworkDataSourceLayer
                        // 등)이 이미 "terrainProvider instanceof EllipsoidTerrainProvider ⇒ 지형 없음"
                        // 관례로 hasRealTerrain 을 판정하고 있어 그 판정과 자연스럽게 맞아떨어진다.
                        // combine 미들웨어 스택(immer+subscribeWithSelector)에서 get 타입 추론이
                        // 꼬여서, get 대신 useCesiumStore.getState()를 콜백 내부에서 직접 참조한다
                        // (이 함수가 실제로 호출되는 시점엔 useCesiumStore가 이미 정의돼 있음).
                        setTerrainEnabled: (enabled: boolean) => {
                            const viewer = useCesiumStore.getState().viewer;
                            if (!viewer) return;
                            set({ terrainEnabled: enabled });
                            if (!enabled) {
                                viewer.terrainProvider = new Cesium.EllipsoidTerrainProvider();
                                try { viewer.scene.requestRender(); } catch (_) {}
                                return;
                            }
                            Cesium.CesiumTerrainProvider.fromUrl(CESIUM_TERRAIN_URL, { requestVertexNormals: true })
                                .then((provider) => {
                                    // 로딩 도중 다시 껐으면 적용하지 않음
                                    if (!useCesiumStore.getState().terrainEnabled) return;
                                    viewer.terrainProvider = provider;
                                    try { viewer.scene.requestRender(); } catch (_) {}
                                })
                                .catch((e) => console.error('[Cesium] 지형 로드 실패:', e));
                        },
                    })
                )
            )
        )
    )
);