import * as Cesium from "cesium";
import { Style } from "ol/style";
import {getFeaturesByProperties} from "@utils/feature";
import {SignalTimelineResponse} from "@stores/useSignalTimelineStore";
import {LayerManager} from "@deck.gl/core";
import {Feature} from "ol";
import {SignalData} from "@type/Signal";

export type SignalState = "green" | "yellow" | "red" | "default";

interface ParsedEntry {
    start: number;
    end: number;
    connKeys: string[];
    state: string;
}

interface SignalCache {
    signalConnectionSet: Set<string>;
    entries: ParsedEntry[];
}

let signalCache: SignalCache | null = null;
let lastCachedTimeline: SignalTimelineResponse[] | null = null;

export const buildSignalCache = (signalTimeline: SignalTimelineResponse[]): SignalCache => {
    const signalConnectionSet = new Set<string>();
    const entries: ParsedEntry[] = [];

    signalTimeline?.forEach(sig => {
        // turn id → connKeys 맵 (한 번만 계산)
        const turnConnMap = new Map<string | number, string[]>();
        sig.turnInfo.forEach(turn => {
            const keys = turn.connList.map(connId => `${sig.nodeId}_${connId}`);
            keys.forEach(k => signalConnectionSet.add(k));
            turnConnMap.set(turn.id, keys);
        });

        sig.signalTimeline.forEach(timeline => {
            const start = new Date(timeline.startTime).getTime();
            const end = new Date(timeline.endTime).getTime();
            const connKeys: string[] = [];
            timeline.activeTurns.forEach(turnId => {
                const keys = turnConnMap.get(turnId) ?? turnConnMap.get(Number(turnId));
                if (keys) keys.forEach(k => connKeys.push(k));
            });
            if (connKeys.length > 0) {
                entries.push({ start, end, connKeys, state: timeline.signalState });
            }
        });
    });

    return { signalConnectionSet, entries };
};

export const updateSignalStyles = (layerManager: LayerManager, viewer: Cesium.Viewer, connectionFeatureMapRef: Map<string, Feature>, signalTimeline: SignalTimelineResponse[], currentSimTime: number) => {
    if (connectionFeatureMapRef.size === 0) {
        const networkLayer = layerManager.getLayer("facility", "network")?.[0];
        if (!networkLayer) return;

        const styleFunction = networkLayer.getStyleFunction();
        const features = getFeaturesByProperties(networkLayer, { featureType: "connections" });
        features.forEach(f => {
            const nodeId = f.get("nodeId");
            const connId = f.get("id");
            connectionFeatureMapRef.set(`${nodeId}_${connId}`, f);
            if (!f.get('__originalStyle')) {
                const originalStyle = styleFunction(f, 1);
                f.set('__originalStyle', Array.isArray(originalStyle) ? originalStyle : [originalStyle]);
            }
        });
    }

    // timeline이 바뀐 경우에만 캐시 재빌드
    if (signalTimeline !== lastCachedTimeline) {
        signalCache = buildSignalCache(signalTimeline);
        lastCachedTimeline = signalTimeline;
    }
    if (!signalCache) return;

    const { signalConnectionSet, entries } = signalCache;

    // 현재 시간에 active한 connection → state 매핑
    const activeMap = new Map<string, string>();
    for (const entry of entries) {
        if (currentSimTime >= entry.start && currentSimTime < entry.end) {
            for (const key of entry.connKeys) {
                if (!activeMap.has(key)) activeMap.set(key, entry.state);
            }
        }
    }

    connectionFeatureMapRef.forEach((feature, key) => {
        if (!signalConnectionSet.has(key)) return;
        const state = activeMap.get(key) ?? "red";
        applyOlSignalStyle(feature, state as SignalState);
        applyCesiumSignalStyle(viewer, feature.get('__guid'), state as SignalState);
    });
};

export const getSignalColor = (state: SignalState) => {
    switch (state) {
        case "green": return { css: "rgba(0,255,0)", cesium: Cesium.Color.GREEN.withAlpha(0.7) };
        case "yellow": return { css: "rgba(255,255,0)", cesium: Cesium.Color.YELLOW.withAlpha(0.7) };
        case "red": return { css: "rgba(255,0,0)", cesium: Cesium.Color.RED.withAlpha(0.7) };
        default: return { css: "rgba(255,255,255)", cesium: Cesium.Color.WHITE.withAlpha(0.7) };
    }
};

// OpenLayers 스타일 적용
export const applyOlSignalStyle = (feature: any, state: SignalState) => {
    const originalStyles: Style[] = feature.get('__originalStyle');
    if (!originalStyles) return;

    const { css } = getSignalColor(state);

    const newStyles = originalStyles.map(style => {
        const newStyle = style.clone();
        newStyle.getStroke()?.setColor(css);
        newStyle.getFill()?.setColor(css);
        return newStyle;
    });

    feature.setStyle(newStyles);
};

// Cesium 스타일 적용
export const applyCesiumSignalStyle = (viewer: Cesium.Viewer, guid: string, state: SignalState) => {
    if (!guid) return;
    // 인덱스(0번)로 가져오면 안 된다 — 차량 CZML 데이터소스가 뷰포트 스트리밍(팬/줌)마다
    // remove+add 되면서 dataSources 컬렉션 순서가 바뀌어, 네트워크가 아닌 차량 CZML(마침 교체
    // 중인) 쪽을 잡을 수 있다. NetworkDataSourceLayer가 부여한 이름으로 조회한다.
    const dataSource = viewer.dataSources.getByName("network")[0];
    if (!dataSource) return;

    const entity = dataSource.entities.getById(guid);
    if (!entity?.polyline) return;

    const { cesium } = getSignalColor(state);
    entity.polyline.material = new Cesium.PolylineArrowMaterialProperty(cesium);
    // clampToGround는 NetworkDataSourceLayer가 커넥션 엔티티 생성 시 이미 true로 고정한다
    // (변하지 않는 값). 재생 중 200ms마다 여기서 재대입하면 Cesium의 ground-polyline
    // 배치(재질별로 묶어 관리)가 매번 다시 dirty 처리된다 — syncNodeEntities()가 카메라
    // 거리 기준으로 같은 커넥션 엔티티를 줌아웃/줌인마다 대량 add/remove 하는 것과 겹치면
    // "Cannot read properties of undefined (reading 'id')"로 렌더 루프가 멈추는 게 실측
    // 재현됐다("줌아웃 후 줌인하면 바로 발생"). 안 바뀌는 값은 다시 대입하지 않는다.
};

export const getNetworkGuid = (layerManager: LayerManager | null, signalGuid: string) => {
    if (!layerManager) return null;

    const networkLayer = layerManager.getLayer("facility", "network")?.[0];
    const signalLayer = layerManager.getLayer("facility", "signal");
    if (!networkLayer || !signalLayer) return null;

    const networkFeatures = networkLayer.getSource?.()?.getFeatures?.() || [];
    const signalFeatures = signalLayer.getSource?.()?.getFeatures?.() || [];

    const connectionFeatures = networkFeatures.filter(
        f => f.get('featureType') === 'connection'
    );

    const targetFeature = signalFeatures.find(
        f => f.get("__guid") === signalGuid
    );
    if (!targetFeature) return null;

    const nodeId = targetFeature.get("nodeId");
    const connectionId = targetFeature.get("connectionId");

    const feature = connectionFeatures.find(
        f => f.get('nodeId') === nodeId && f.get('id') === connectionId
    );

    if (feature) {
        return feature.get('__guid');
    }

    return null;
}


export const getSignalGuid = (layerManager: LayerManager, connectionGuid: string): string | null => {
    if (!layerManager) return null;

    const networkLayer = layerManager.getLayer("facility", "network")?.[0];
    const signalLayer = layerManager.getLayer("facility", "signal");
    if (!networkLayer || !signalLayer) return null;
    const networkFeatures = networkLayer.getSource?.()?.getFeatures?.() || [];
    const signalFeatures = signalLayer.getSource?.()?.getFeatures?.() || [];

    const connectionFeatures = networkFeatures.filter(
        f => f.get('featureType') === 'connection'
    );

    const connectionFeature = connectionFeatures.find(
        f => f.get("__guid") === connectionGuid
    );
    if (!connectionFeature) return null;

    const nodeId = connectionFeature.get("nodeId");
    const connectionId = connectionFeature.get("id");

    const signalFeature = signalFeatures.find(
        f => f.get("nodeId") === nodeId && f.get("connectionId") === connectionId
    );

    return signalFeature?.get("__guid") ?? null;
}

// 신호 phase 1개당 부여되는 길이(초)
const DUMMY_PHASE_DURATION = 30;

/**
 * intersection 노드의 connection을 fromLink(진입로) 기준으로 그룹핑하여
 * 더미 turnList(진입로별 turn 그룹) + planList(진입로 순환 신호 계획)를 생성한다.
 * 각 노드의 plan은 진입로 수만큼의 phase를 30초씩 라운드로빈으로 순환한다.
 */
export const generateDummySignals = (network: any): Omit<SignalData, "__guid" | "featureType" | "id">[] => {
    const signals: Omit<SignalData, "__guid" | "featureType" | "id">[] = [];

    for (const node of network?.nodes ?? []) {
        if (node.type?.toLowerCase() !== 'intersection') continue;
        const conns = node.connections ?? [];
        if (conns.length === 0) continue;

        // fromLink(진입로) 기준 그룹핑 → 그룹 하나 = turn 그룹(approach)
        const groups = new Map<string, any[]>();
        for (const conn of conns) {
            const key = String(conn.fromLink ?? 'default');
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(conn);
        }
        const groupKeys = Array.from(groups.keys());

        groupKeys.forEach((key, groupIdx) => {
            const turnId = String(groupIdx);
            groups.get(key)!.forEach((conn, i) => {
                const entry: Omit<SignalData, "__guid" | "featureType" | "id"> = {
                    nodeId: String(node.id),
                    turnId,
                    turning: conn.turning ?? 'S',
                    type: conn.turning === 'R' ? 'RTOR' : 'None',
                    connectionId: String(conn.id),
                };
                // 노드의 첫 번째 레코드에만 planList 부착
                if (groupIdx === 0 && i === 0) {
                    entry.plans = [{
                        id: '0',
                        cycle: String(groupKeys.length * DUMMY_PHASE_DURATION),
                        offset: '0',
                        phases: groupKeys.map((_, idx) => ({
                            id: String(idx),
                            duration: String(DUMMY_PHASE_DURATION),
                            turnList: String(idx),
                        })),
                    }];
                }
                signals.push(entry);
            });
        });
    }

    return signals;
};
