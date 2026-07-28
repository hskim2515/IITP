import * as Cesium from "cesium";
import { Style } from "ol/style";
import {getFeaturesByProperties} from "@utils/feature";
import {SignalTimelineResponse} from "@stores/useSignalTimelineStore";
import {LayerManager} from "@deck.gl/core";
import {Feature} from "ol";
import {SignalData} from "@type/Signal";
import {normalizeTurning} from "@utils/turning";

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

// 신호 phase(그룹) 1개당 부여되는 길이(초)
const DUMMY_PHASE_DURATION = 30;
// 두 접근로 방위각差가 180±이 값(도) 이내면 "마주보는 방향"으로 보고 동시 녹색 페어로 묶는다.
// (iitp-rest DummySignalGenerator.buildNodeSignalBlockOrNull 과 동일 기준 — 백엔드 KTDB
// 대형망 임포트가 만드는 더미 신호와 프론트에서 수동으로 다시 생성하는 더미 신호가 같은
// 품질(마주보는 접근로끼리만 동시 녹색)을 갖도록 일치시킨다.)
const OPPOSITE_BEARING_TOLERANCE_DEG = 30;

const parseCenter = (center?: string): [number, number] | null => {
    if (!center) return null;
    const parts = center.trim().split(/\s+/);
    if (parts.length < 2) return null;
    const x = Number(parts[0]), y = Number(parts[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
};

const angularDiffDeg = (a: number, b: number): number => {
    const diff = Math.abs(a - b) % 360;
    return diff > 180 ? 360 - diff : diff;
};

// ── OSM 신호등 게이트 ────────────────────────────────────────────────────────
// iitp-rest OsmTrafficSignalMatcher와 동일 임계값(40m) — 백엔드 더미 신호 생성과 프론트
// 수동 재생성이 같은 기준으로 판정하도록 일치.
const OSM_SIGNAL_MATCH_DIST_M = 40;

const haversineM = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371000;
    const toRad = Math.PI / 180;
    const p1 = lat1 * toRad, p2 = lat2 * toRad;
    const dPhi = (lat2 - lat1) * toRad;
    const dLmb = (lng2 - lng1) * toRad;
    const a = Math.sin(dPhi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLmb / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
};

/**
 * 네트워크 노드들의 bbox 내 실제 OSM 신호등(highway=traffic_signals) 좌표를 서버에서 받아온다
 * (GET /network/osm-traffic-signals, iitp-rest NetworkController — OsmTrafficSignalRepository
 * 로컬 DB 조회, OsmTrafficSignalImporter로 사전 적재됨). 네트워크가 비었거나 좌표가 하나도
 * 없거나 요청이 실패하면 빈 배열 — 호출부가 게이트를 건너뛰고 기존 동작으로 폴백한다.
 */
const fetchOsmTrafficSignals = async (
    nodeLatLng: Map<string, { lat: number; lng: number }>,
): Promise<{ lat: number; lon: number }[]> => {
    if (nodeLatLng.size === 0) return [];
    let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
    for (const { lat, lng } of nodeLatLng.values()) {
        if (lat < south) south = lat;
        if (lat > north) north = lat;
        if (lng < west) west = lng;
        if (lng > east) east = lng;
    }
    if (!Number.isFinite(south) || !Number.isFinite(west)) return [];

    try {
        const base = import.meta.env.VITE_API_URL;
        const bbox = `${west},${south},${east},${north}`;
        const res = await fetch(`${base}/network/osm-traffic-signals?bbox=${encodeURIComponent(bbox)}`);
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.warn("[signal] OSM 신호등 조회 실패(게이트 건너뜀):", e);
        return [];
    }
};

/** WGS84 방위각(도, 0~360, 북=0/동=90) — useNetworkDraw.ts의 computeBearing과 동일 공식. */
const computeBearingLatLng = (from: { lat: number; lng: number }, to: { lat: number; lng: number }): number => {
    const toRad = Math.PI / 180;
    const lat1 = from.lat * toRad, lat2 = to.lat * toRad;
    const dLng = (to.lng - from.lng) * toRad;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

/**
 * 접근로(fromLink)가 intersectionNodeId로 들어오는 방위각(도, 0~360). 좌표 없으면 null.
 * KTDB 등 임포트된 네트워크는 로컬 평면좌표(center)를 우선 쓰고, 수동으로 그린 네트워크는
 * center가 비어 있는 대신 WGS84 좌표(coordinates)가 있으므로 그걸로 폴백한다(그래야
 * NetworkMaintenancePanel "화면 내 더미 신호 생성"도 방위각 기반 페어링 혜택을 받는다).
 */
const approachBearingDeg = (
    fromLinkId: string,
    intersectionNodeId: string,
    linkEndpoints: Map<string, { from: string; to: string }>,
    nodeCoords: Map<string, [number, number]>,
    nodeLatLng: Map<string, { lat: number; lng: number }>,
): number | null => {
    const link = linkEndpoints.get(fromLinkId);
    if (!link) return null;
    const upstreamNodeId = link.to === intersectionNodeId ? link.from : link.to;

    const upstream = nodeCoords.get(upstreamNodeId);
    const here = nodeCoords.get(intersectionNodeId);
    if (upstream && here) {
        const dx = here[0] - upstream[0];
        const dy = here[1] - upstream[1];
        if (dx !== 0 || dy !== 0) {
            const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
            return deg < 0 ? deg + 360 : deg;
        }
    }

    const upstreamLL = nodeLatLng.get(upstreamNodeId);
    const hereLL = nodeLatLng.get(intersectionNodeId);
    if (upstreamLL && hereLL && (upstreamLL.lat !== hereLL.lat || upstreamLL.lng !== hereLL.lng)) {
        return computeBearingLatLng(upstreamLL, hereLL);
    }
    return null;
};

/**
 * 접근로(fromLink id 목록, turnId 부여 순서)를 마주보는(≈180도) 쌍으로 묶는다 — 실제
 * 2페이즈 신호와 동일 원리(반대편끼리 동시 녹색). 방위각을 계산 못 하거나(좌표 데이터 없음)
 * 마주보는 짝을 못 찾은 접근로는 단독 그룹으로 남긴다 — 잘못 페어링해 직교하는 접근로가
 * 동시 녹색이 되는 것보다 항상 안전하다.
 */
const groupApproachesByOppositeBearing = (
    approachOrder: string[],
    intersectionNodeId: string,
    linkEndpoints: Map<string, { from: string; to: string }>,
    nodeCoords: Map<string, [number, number]>,
    nodeLatLng: Map<string, { lat: number; lng: number }>,
): string[][] => {
    const bearings = new Map<string, number>();
    for (const fromLink of approachOrder) {
        const b = approachBearingDeg(fromLink, intersectionNodeId, linkEndpoints, nodeCoords, nodeLatLng);
        if (b !== null) bearings.set(fromLink, b);
    }

    const groups: string[][] = [];
    const paired = new Set<string>();
    for (const a of approachOrder) {
        if (paired.has(a)) continue;
        const ba = bearings.get(a);
        let bestPartner: string | null = null;
        let bestDist = Infinity;
        if (ba !== undefined) {
            for (const b of approachOrder) {
                if (b === a || paired.has(b)) continue;
                const bb = bearings.get(b);
                if (bb === undefined) continue;
                const dist = Math.abs(angularDiffDeg(ba, bb) - 180);
                if (dist <= OPPOSITE_BEARING_TOLERANCE_DEG && dist < bestDist) {
                    bestDist = dist;
                    bestPartner = b;
                }
            }
        }
        paired.add(a);
        if (bestPartner) {
            paired.add(bestPartner);
            groups.push([a, bestPartner]);
        } else {
            groups.push([a]);
        }
    }
    return groups;
};

/**
 * intersection 노드의 connection을 fromLink(진입로) 기준으로 그룹핑하여
 * 더미 turnList(진입로별 turn 그룹) + planList(진입로 순환 신호 계획)를 생성한다.
 * 노드/링크 좌표(center, fromNode/toNode)가 있으면 마주보는 접근로끼리 페어링해 동시
 * 녹색을 주는 표준 2페이즈로 운영하고(iitp-rest DummySignalGenerator와 동일 기준),
 * 좌표가 없거나 짝을 못 찾은 접근로는 30초씩 단독으로 도는 라운드로빈으로 안전하게 폴백한다.
 *
 * OSM 신호등 게이트(실측: 부천 참조데이터 — 커넥션 있는 노드 104개 중 신호는 18개뿐)를
 * iitp-rest DummySignalGenerator와 동일 기준으로 적용 — 네트워크 bbox 내 실제 OSM
 * highway=traffic_signals 위치를 미리 받아와, 그 근처(40m)에서만 신호를 생성한다. 비동기
 * 네트워크 호출이 실패하거나(오프라인 등) 서버에 OSM 데이터가 아직 없으면 빈 배열로 취급해
 * 게이트를 건너뛴다(기존 포트 기반 판정만으로 동작 — 회귀 방지).
 */
export const generateDummySignals = async (network: any): Promise<Omit<SignalData, "__guid" | "featureType" | "id">[]> => {
    const signals: Omit<SignalData, "__guid" | "featureType" | "id">[] = [];

    const nodeCoords = new Map<string, [number, number]>();
    const nodeLatLng = new Map<string, { lat: number; lng: number }>();
    for (const n of network?.nodes ?? []) {
        if (n?.id == null) continue;
        const xy = parseCenter(n?.center);
        if (xy) nodeCoords.set(String(n.id), xy);
        // center가 비어있는 수동 그리기 네트워크 폴백용 — WGS84 좌표
        const lat = n?.coordinates?.lat, lng = n?.coordinates?.lng;
        if (typeof lat === 'number' && typeof lng === 'number') nodeLatLng.set(String(n.id), { lat, lng });
    }
    const linkEndpoints = new Map<string, { from: string; to: string }>();
    for (const l of network?.links ?? []) {
        if (l?.id != null && l?.fromNode != null && l?.toNode != null) {
            linkEndpoints.set(String(l.id), { from: String(l.fromNode), to: String(l.toNode) });
        }
    }

    const osmSignals = await fetchOsmTrafficSignals(nodeLatLng);
    const hasOsmSignalNear = (lat: number, lng: number): boolean => {
        for (const s of osmSignals) {
            if (haversineM(lat, lng, s.lat, s.lon) <= OSM_SIGNAL_MATCH_DIST_M) return true;
        }
        return false;
    };

    for (const node of network?.nodes ?? []) {
        // node.type === 'intersection'은 KTDB/SUMO 임포트 컨버터만 붙이는 값이라, 직접 그리기
        // 도구로 만든 노드는 실제 교차로가 돼도 영원히 'normal'로 남는다 — 그 결과 직접
        // 그린/편집한 교차로엔 더미 신호가 하나도 안 생기는 버그가 있었다(pavementMarking.ts와
        // 동일 버그). useNetworkDraw.ts의 autoGenerateAllIntersections와 동일한 포트 기반
        // 판정으로 교체(진입/진출 포트가 모두 있으면 실제 교차로).
        //
        // ⚠️ 후속 버그(실측: 위성영상 대조): 위 판정이 KTDB의 순수 통과점(type=normal, 1진입+
        // 1진출 — KtdbNetworkConverter.classifyNodeType 기준 명시적으로 "교차로 아님")까지
        // 통과시켜, 실제로는 분기 없는 도로 중간 지점에 더미 신호가 생성됐다. 진짜 분기(선택
        // 지점)가 있으려면 1진입+1진출 단독 조합은 제외해야 한다 — Merging(2+in/1out)·
        // Diverging(1in/2+out)·Intersection(2+in/2+out)만 통과.
        const inCount = node.ports?.filter((p: any) => p.type === 'in').length ?? 0;
        const outCount = node.ports?.filter((p: any) => p.type === 'out').length ?? 0;
        if (inCount < 1 || outCount < 1) continue;
        if (inCount === 1 && outCount === 1) continue;
        const conns = node.connections ?? [];
        if (conns.length === 0) continue;

        // OSM 신호등 게이트 — 위 파일 상단 주석 참고. 좌표를 못 구하면(수동 그리기 등) 판정
        // 불가로 보고 기존 동작 유지(과소생성보다 과다생성이 덜 위험 — 신호 메뉴에서 직접 지울 수 있음).
        if (osmSignals.length > 0) {
            const ll = nodeLatLng.get(String(node.id));
            if (ll && !hasOsmSignalNear(ll.lat, ll.lng)) continue;
        }

        // fromLink(진입로) 기준 그룹핑 → 그룹 하나 = turn 그룹(approach)
        const groups = new Map<string, any[]>();
        for (const conn of conns) {
            const key = String(conn.fromLink ?? 'default');
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(conn);
        }
        const groupKeys = Array.from(groups.keys());
        const turnIdOf = new Map(groupKeys.map((key, idx) => [key, String(idx)]));

        const phaseGroups = groupApproachesByOppositeBearing(
            groupKeys, String(node.id), linkEndpoints, nodeCoords, nodeLatLng,
        );

        groupKeys.forEach((key, groupIdx) => {
            const turnId = String(groupIdx);
            groups.get(key)!.forEach((conn, i) => {
                // conn.turning은 KTDB(짧은 코드 "S"/"L"/"R"/"U")와 직접 그리기 도구(전체 단어
                // "Straight"/"Left_Turn"/...)가 섞여 들어온다 — 정규화 없이 그대로 저장/비교하면
                // (1) SignalData.turning이 짧은 코드로 저장된 신호는 SignalGroupedEditor의 방향
                // select(DIR, 전체 단어 기준)와 형식이 안 맞고, (2) RTOR(적신호 우회전) 판정도
                // conn.turning === 'R' 비교라 직접 그린 우회전 커넥션은 항상 놓친다.
                // SignalData.turning의 canonical 형식은 전체 단어(SignalGroupedEditor의 DIR/select
                // 값 참고)이므로 그쪽으로 정규화.
                const normalized = normalizeTurning(conn.turning);
                const entry: Omit<SignalData, "__guid" | "featureType" | "id"> = {
                    nodeId: String(node.id),
                    turnId,
                    turning: normalized,
                    type: normalized === 'Right_Turn' ? 'RTOR' : 'None',
                    connectionId: String(conn.id),
                };
                // 노드의 첫 번째 레코드에만 planList 부착
                if (groupIdx === 0 && i === 0) {
                    entry.plans = [{
                        id: '0',
                        cycle: String(phaseGroups.length * DUMMY_PHASE_DURATION),
                        offset: '0',
                        phases: phaseGroups.map((group, idx) => ({
                            id: String(idx),
                            duration: String(DUMMY_PHASE_DURATION),
                            turnList: group.map(fromLink => turnIdOf.get(fromLink)).join(' '),
                        })),
                    }];
                }
                signals.push(entry);
            });
        });
    }

    return signals;
};

/* ──────────────────── 수동 편집 상충(양방향 사고위험) 검사 ────────────────── */

/** 두 접근로(fromLink)가 같은 현시(phase)에서 동시 녹색이어도 안전한지 판정.
 * 같은 접근로(같은 fromLink의 서로 다른 회전)이거나 마주보는(≈180±허용오차) 방위각 쌍이면 안전 —
 * generateDummySignals/groupApproachesByOppositeBearing과 동일 기준. 좌표가 없어 방위각을
 * 계산 못 하면(임포트 데이터 미비) 판정 불가로 보고 통과시킨다(false positive 방지). */
export const isSafeApproachPair = (
    fromLinkA: string,
    fromLinkB: string,
    intersectionNodeId: string,
    linkEndpoints: Map<string, { from: string; to: string }>,
    nodeCoords: Map<string, [number, number]>,
    nodeLatLng: Map<string, { lat: number; lng: number }>,
): boolean => {
    if (fromLinkA === fromLinkB) return true;
    const a = approachBearingDeg(fromLinkA, intersectionNodeId, linkEndpoints, nodeCoords, nodeLatLng);
    const b = approachBearingDeg(fromLinkB, intersectionNodeId, linkEndpoints, nodeCoords, nodeLatLng);
    if (a === null || b === null) return true;
    return Math.abs(angularDiffDeg(a, b) - 180) <= OPPOSITE_BEARING_TOLERANCE_DEG;
};

export interface SignalPhaseConflict {
    planId: string;
    phaseId: string;
    myFromLink: string;
    conflictingTurnId: string;
    conflictingFromLink: string;
}

/**
 * 신호(SignalGroupedEditor) 수동 편집 시 상충 검사. candidate(저장하려는 레코드)의 turnId가
 * 소속된 현시(phase)에, candidate의 connectionId가 가리키는 접근로(fromLink)와 마주보지 않는
 * (직교/인접 등) 다른 접근로가 이미 같이 묶여 있으면 경고 대상으로 반환한다.
 * plans(turnId→phase 소속)는 해당 노드의 신호 레코드 중 하나에 부착돼 있다(generateDummySignals
 * 참고 — "노드의 첫 레코드에만 planList 부착").
 */
export const checkManualSignalEditConflicts = (
    network: any,
    nodeSignals: SignalData[],
    candidate: SignalData,
): SignalPhaseConflict[] => {
    const nodeId = String(candidate.nodeId ?? "");
    const node = (network?.nodes ?? []).find((n: any) => String(n.id) === nodeId);
    if (!node || candidate.turnId == null || !candidate.connectionId) return [];

    const connFromLink = new Map<string, string>();
    for (const conn of node.connections ?? []) {
        if (conn?.id != null && conn?.fromLink != null) connFromLink.set(String(conn.id), String(conn.fromLink));
    }
    const myFromLink = connFromLink.get(String(candidate.connectionId));
    if (!myFromLink) return [];

    const merged = nodeSignals.some(s => s.__guid && s.__guid === candidate.__guid)
        ? nodeSignals.map(s => (s.__guid === candidate.__guid ? candidate : s))
        : [...nodeSignals, candidate];

    const planHolder = merged.find(s => s.plans && s.plans.length > 0);
    const plans = planHolder?.plans ?? [];
    if (plans.length === 0) return [];

    const turnIdToFromLinks = new Map<string, Set<string>>();
    for (const s of merged) {
        if (s.turnId == null || !s.connectionId) continue;
        const fl = connFromLink.get(String(s.connectionId));
        if (!fl) continue;
        const tid = String(s.turnId);
        if (!turnIdToFromLinks.has(tid)) turnIdToFromLinks.set(tid, new Set());
        turnIdToFromLinks.get(tid)!.add(fl);
    }

    const nodeCoords = new Map<string, [number, number]>();
    const nodeLatLng = new Map<string, { lat: number; lng: number }>();
    for (const n of network?.nodes ?? []) {
        if (n?.id == null) continue;
        const xy = parseCenter(n?.center);
        if (xy) nodeCoords.set(String(n.id), xy);
        const lat = n?.coordinates?.lat, lng = n?.coordinates?.lng;
        if (typeof lat === "number" && typeof lng === "number") nodeLatLng.set(String(n.id), { lat, lng });
    }
    const linkEndpoints = new Map<string, { from: string; to: string }>();
    for (const l of network?.links ?? []) {
        if (l?.id != null && l?.fromNode != null && l?.toNode != null) {
            linkEndpoints.set(String(l.id), { from: String(l.fromNode), to: String(l.toNode) });
        }
    }

    const myTurnId = String(candidate.turnId);
    const conflicts: SignalPhaseConflict[] = [];
    for (const plan of plans) {
        for (const phase of plan.phases ?? []) {
            const turnIds = (phase.turnList ?? "").split(/\s+/).filter(Boolean);
            if (!turnIds.includes(myTurnId)) continue;
            for (const otherTid of turnIds) {
                if (otherTid === myTurnId) continue;
                for (const otherFromLink of turnIdToFromLinks.get(otherTid) ?? []) {
                    if (isSafeApproachPair(myFromLink, otherFromLink, nodeId, linkEndpoints, nodeCoords, nodeLatLng)) continue;
                    conflicts.push({ planId: plan.id, phaseId: phase.id, myFromLink, conflictingTurnId: otherTid, conflictingFromLink: otherFromLink });
                }
            }
        }
    }
    return conflicts;
};

/** TOD 편집(SignalTodTimelineEditor) 시 상충 검사. 같은 노드에서 서로 다른 두 플랜의 시간 범위가
 * 겹치면 두 플랜의 현시가 동시에 활성화되어(updateSignalStyles/buildSignalCache는 겹치는 구간의
 * 모든 activeTurns를 합쳐 반영) 원래는 서로 다른 시간대에만 켜지도록 분리된 상충 방향들이 같이
 * 녹색이 될 수 있다. */
export const findOverlappingTodPlans = (
    plans: { id: string | number; startTime: string; endTime: string }[],
    candidate: { id: string | number; startTime: string; endTime: string },
    excludeIndex?: number,
): { id: string | number; startTime: string; endTime: string }[] => {
    const toMin = (hhmm: string): number => {
        const [h, m] = (hhmm ?? "00:00").slice(0, 5).split(":").map(Number);
        return (h || 0) * 60 + (m || 0);
    };
    const start = toMin(candidate.startTime);
    const end = toMin(candidate.endTime);
    return plans.filter((p, idx) => {
        if (idx === excludeIndex) return false;
        if (String(p.id) === String(candidate.id)) return false;
        const pStart = toMin(p.startTime);
        const pEnd = toMin(p.endTime);
        return start < pEnd && pStart < end;
    });
};
