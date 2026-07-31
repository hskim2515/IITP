import VectorSource from "ol/source/Vector";
import { getActiveVersionId } from "@utils/versionId";
import VectorLayer from "ol/layer/Vector";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { Feature } from "ol";
import { FEATURE_TYPE } from "@type/Signal";
import { fromLonLat } from "ol/proj";
import { Point } from "ol/geom";
import { generateGUIDWithType } from "@utils/guid";
import { SignalData } from "@type/Signal";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useSignalTimelineStore, SignalTimelineResponse } from "@stores/useSignalTimelineStore";
import { useSimulationStore } from "@stores/useSimulationStore";
import { JulianDate } from "cesium";
import { Coordinate } from "ol/coordinate";
import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import { Style, Icon, Circle as CircleStyle, Fill, Text, Stroke } from "ol/style";
import { FeatureLike } from "ol/Feature";
import { signalRenderState } from "@stores/signalRenderState";
import { getSignalLodTierByResolution, SIGNAL_TILING } from "@utils/lodConstants";
import { SignalTileManager } from "@managers/SignalTileManager";
import { SignalTileMembership } from "@managers/signalTileMembership";
import { unByKey } from "ol/Observable";
import type { EventsKey } from "ol/events";
import type OLMap from "ol/Map";
import { diffSignalEditsByNode } from "@utils/signal";
import { normalizeTurning } from "@utils/turning";

/* ── 신호등 캔버스 아이콘 (정적) ── */
function createTrafficLightIcon(): HTMLCanvasElement {
    const W = 14, H = 34, R = 5, PAD = 2;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#212121";
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#5a0000";
    ctx.beginPath();
    ctx.arc(W / 2, PAD + R, R, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#5a5a00";
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, R, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#005a00";
    ctx.beginPath();
    ctx.arc(W / 2, H - PAD - R, R, 0, Math.PI * 2);
    ctx.fill();

    return canvas;
}

const TRAFFIC_LIGHT_ICON = createTrafficLightIcon();

// "2026-04-06T06:34:07Z" → "06:34:07"
function isoToTime(iso: string): string {
    return iso.substring(11, 19);
}

function utcHHMMSS(jd: JulianDate): string {
    const d = JulianDate.toDate(jd);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function signalStyle(feature: FeatureLike, resolution: number): Style[] {
    const tier = getSignalLodTierByResolution(resolution);
    // cluster tier: 완전 숨김 (원거리)
    if (tier === 'cluster') return [];

    const nodeId    = String(feature.get("nodeId") ?? "");
    const connGuids = (feature.get("connGuids") as string[]) ?? [];
    const connIds   = (feature.get("connIds")   as string[]) ?? [];
    const turnings  = (feature.get("turnings")  as string[]) ?? [];

    const state   = signalRenderState.nodeState.get(nodeId) ?? "";
    const actives = signalRenderState.activeConns.get(nodeId);

    let dotColor = "#5a0000"; // 기본: 빨강 off
    if (state === "yellow") {
        dotColor = "#ffff00";
    } else if (actives && (connGuids.some(g => actives.has(g)) || connIds.some(id => actives.has(id)))) {
        dotColor = "#00ff00";
    } else if (state !== "") {
        dotColor = "#ff0000";
    }

    // marker tier(SIGNAL_DOT ~ SIGNAL_ICON): 컬러 dot만 표시
    if (tier === 'marker') {
        const dotR = Math.min(5, Math.max(2, 2.5 / resolution));
        return [new Style({
            image: new CircleStyle({ radius: dotR, fill: new Fill({ color: dotColor }) }),
        })];
    }

    // 근거리(< SIGNAL_ICON): 신호등 아이콘 + 컬러 dot + 방향 화살표
    const arrowParts: string[] = [];
    const normalizedTurnings = new Set(turnings.map(normalizeTurning));
    if (normalizedTurnings.has("U_Turn"))     arrowParts.push("↩");
    if (normalizedTurnings.has("Left_Turn"))  arrowParts.push("←");
    if (normalizedTurnings.has("Straight"))   arrowParts.push("↑");
    if (normalizedTurnings.has("Right_Turn")) arrowParts.push("→");
    const arrowText = arrowParts.join("");

    const styles: Style[] = [
        new Style({
            image: new Icon({ img: TRAFFIC_LIGHT_ICON, scale: 1.0, anchor: [0.5, 1.0] }),
        }),
        new Style({
            image: new CircleStyle({ radius: 5, fill: new Fill({ color: dotColor }) }),
        }),
    ];

    if (arrowText) {
        styles.push(new Style({
            text: new Text({
                text: arrowText,
                font: "bold 10px sans-serif",
                fill: new Fill({ color: "#ffffff" }),
                stroke: new Stroke({ color: "#000000", width: 2 }),
                offsetY: -7,
            }),
        }));
    }

    return styles;
}

export class SignalFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "signal";
    private unsubscribes: Array<() => void> = [];
    private colorInterval: ReturnType<typeof setInterval> | null = null;
    private lastWallClock = "";

    // ── 신호 타일링 (SIGNAL_TILING.ENABLED 일 때만; 읽기 전용) ──
    // viewport 신호 데이터(nodeId → signal)만 메모리 보유. feature 위치는 네트워크 링크에서 파생.
    private tileManager: SignalTileManager | null = null;
    private membership = new SignalTileMembership();
    private moveEndKey: EventsKey | null = null;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: true,
            zIndex: 400,
            updateWhileAnimating: true,
            updateWhileInteracting: true,
            style: (feature: FeatureLike, resolution: number) => signalStyle(feature, resolution),
        });

        this.source = source;

        const signalStore = layerNameToStoreMap[this.LAYER_NAME];
        if (signalStore) {
            this.unsubscribes.push(signalStore.subscribe(
                (s: any) => s.currentJsonData,
                () => this.load(),
                { equalityFn: (a: any, b: any) => a === b }
            ));
            // 저장 완료(isChanged: true → false) — DataIOPanel의 저장은 currentJsonData만
            // 서버에 보낼 뿐 originData는 그대로 두므로, 손대지 않으면 diffSignalEditsByNode가
            // 방금 저장된 노드도 계속 "로컬 편집"으로 오인해 오버레이가 안 사라진다. origin을
            // 지금 값으로 맞추고, 타일도 새로고침해 서버에 실제로 반영된 최신본을 받아온다.
            this.unsubscribes.push((signalStore as any).subscribe(
                (s: any) => s.isChanged,
                (isChanged: boolean, prevIsChanged: boolean) => {
                    if (!prevIsChanged || isChanged) return;
                    const cur = signalStore.getState().currentJsonData;
                    if (cur) signalStore.getState().setOriginData(cur);
                    if (SIGNAL_TILING.ENABLED) {
                        this.tileManager?.clear();
                        const map = this.getMapInternal() as OLMap | null;
                        if (map) this.updateTiles(map);
                    }
                },
            ));
        }
        this.unsubscribes.push(useNetworkStore.subscribe(
            (s: any) => s.currentJsonData,
            () => this.load(),
            { equalityFn: (a: any, b: any) => a === b }
        ));

        this.load();

        // useSimulationStore.currentTime 기반 독립 시간 계산 (Cesium 렌더 루프 불필요)
        this.colorInterval = setInterval(() => {
            this.updateSignalColors();
            if (signalRenderState.nodeState.size > 0) {
                this.source.changed();
            }
        }, 500);
    }

    private updateSignalColors(): void {
        const currentTime = useSimulationStore.getState().currentTime;
        if (!currentTime) return;

        const wallClock = utcHHMMSS(currentTime);
        if (wallClock === this.lastWallClock) return;
        this.lastWallClock = wallClock;

        const timeline: SignalTimelineResponse[] | undefined =
            useSignalTimelineStore.getState().signalTimeline;
        if (!timeline?.length) return;

        const activeConns = new Map<string, Set<string>>();
        const nodeState   = new Map<string, string>();

        for (const entry of timeline) {
            const nodeId = String(entry.nodeId);
            const current = entry.signalTimeline.find(
                s => wallClock >= isoToTime(s.startTime) && wallClock < isoToTime(s.endTime)
            );
            if (!current) continue;
            nodeState.set(nodeId, current.signalState);

            const activeGuids = new Set<string>();
            for (const turnId of current.activeTurns) {
                const turn = entry.turnInfo.find(t => t.id === turnId);
                if (turn) turn.connList.forEach(g => activeGuids.add(g));
            }
            activeConns.set(nodeId, activeGuids);
        }

        signalRenderState.nodeState   = nodeState;
        signalRenderState.activeConns = activeConns;
    }

    public async load(): Promise<void> {
        const drawStore = useNetworkDrawStore.getState();
        if (drawStore.isActive || drawStore.isConnectionActive) return;

        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (!store) return;
        const currentJsonData = store.getState().currentJsonData;
        this.source.clear();
        if (!currentJsonData) return;

        // 타일 모드: viewport 신호(서버 최신) + 로컬 미저장 편집을 nodeId 단위로 병합.
        //   editedNodeIds: 새로 생기거나 내용이 바뀐 노드 → 로컬 레코드로 타일 값을 덮어씀.
        //   deletedNodeIds: 로컬에서 전부 지운 노드 → 타일에 남은 옛 레코드를 숨김.
        // 비-타일 모드: store 전체 신호 그대로 사용(원래도 로컬이 유일한 소스).
        let signals: any[];
        if (SIGNAL_TILING.ENABLED) {
            const originData = store.getState().originData as any;
            const { editedNodeIds, deletedNodeIds } = diffSignalEditsByNode(originData?.signals, currentJsonData.signals);
            const merged = new Map<string, any>();
            for (const s of this.membership.values()) {
                const nid = String(s?.nodeId ?? '');
                if (deletedNodeIds.has(nid)) continue;
                merged.set(nid, s);
            }
            for (const s of currentJsonData.signals ?? []) {
                const nid = String(s?.nodeId ?? '');
                if (editedNodeIds.has(nid)) merged.set(nid, s);
            }
            signals = [...merged.values()];
        } else {
            signals = currentJsonData.signals ?? [];
        }
        if (!signals?.length) return;

        const networkData = useNetworkStore.getState().currentJsonData;
        if (!networkData?.nodes || !networkData?.links) return;

        const signalNodeIds = new Set(signals.map((s: any) => String(s.nodeId)));
        // nodeId → connections 맵
        const nodeConnectionMap = new Map<string, any[]>();
        for (const node of networkData.nodes) {
            nodeConnectionMap.set(String(node.id), node.connections ?? []);
        }
        // nodeId → signal 데이터
        const signalMap = new Map(signals.map((s: any) => [String(s.nodeId), s]));

        const features: Feature[] = [];

        // toNode 기준으로 신호 노드로 진입하는 모든 링크 → 신호등 1개씩
        for (const link of networkData.links) {
            const toNodeId = String(link.toNode);
            if (!signalNodeIds.has(toNodeId)) continue;
            if (!link.coordinates?.length) continue;

            const lastCoord = link.coordinates[link.coordinates.length - 1] as
                { lng: number; lat: number } | undefined;
            if (!lastCoord) continue;

            const fromLinkId = String(link.id);
            const conns = nodeConnectionMap.get(toNodeId) ?? [];
            const connGuids: string[] = [];
            const connIds:   string[] = [];
            const turningSet = new Set<string>();
            for (const conn of conns) {
                if (String(conn.fromLink) === fromLinkId) {
                    connGuids.push(conn.__guid ?? String(conn.id));
                    connIds.push(String(conn.id));
                    if (conn.turning) turningSet.add(String(conn.turning));
                }
            }
            const turnings = [...turningSet];

            const signal = signalMap.get(toNodeId) ?? {};
            const pt = fromLonLat([lastCoord.lng, lastCoord.lat]) as [number, number];
            const feature = new Feature(new Point(pt));
            feature.setProperties({
                ...signal,
                featureType: FEATURE_TYPE.SIGNAL,
                nodeId: toNodeId,
                fromLinkId,
                connGuids,
                connIds,
                turnings,
            });
            features.push(feature);
        }

        this.source.addFeatures(features);
    }

    public createFeature(data: SignalData): Feature {
        const feature = new Feature();
        feature.setProperties({ ...data, featureType: data.featureType ?? FEATURE_TYPE.SIGNAL });
        return feature;
    }

    public createDto(): SignalData {
        return {
            id: undefined,
            __guid: generateGUIDWithType(this.getFeatureType()),
            featureType: FEATURE_TYPE.SIGNAL,
            nodeId: undefined,
            turning: null,
            type: null,
            connectionId: undefined,
        };
    }

    public recordToDto(record: Record<string, unknown>): SignalData {
        const { geometry, ...cleaned } = record;
        const guid = cleaned.__guid ?? generateGUIDWithType(this.getFeatureType());
        return {
            ...(cleaned as Omit<SignalData, "featureType" | "__guid">),
            featureType: FEATURE_TYPE.SIGNAL,
            __guid: guid,
        } as SignalData;
    }

    public getFeatureType(): string {
        return FEATURE_TYPE.SIGNAL;
    }

    /** OL이 레이어를 map에 추가/제거할 때 — 타일 모드면 moveend 구독 + 초기 갱신 */
    override setMapInternal(map: OLMap | null): void {
        if (this.moveEndKey) { unByKey(this.moveEndKey); this.moveEndKey = null; }
        super.setMapInternal(map);
        if (map && SIGNAL_TILING.ENABLED) {
            this.moveEndKey = map.on('moveend', () => this.updateTiles(map));
            this.updateTiles(map);
        } else if (!map) {
            this.tileManager?.clear();
            this.tileManager = null;
        }
    }

    private updateTiles(map: OLMap): void {
        const view = map.getView();
        const size = map.getSize();
        const resolution = view.getResolution();
        if (!size || resolution == null) return;
        if (!this.tileManager) {
            const versionId = getActiveVersionId();
            if (!versionId) return;
            this.tileManager = new SignalTileManager(String(versionId), {
                onTileLoaded: (_k, payload) => { if (this.membership.add(payload)) this.load(); },
                onTileEvicted: (_k, payload) => { if (this.membership.remove(payload)) this.load(); },
            });
        }
        this.tileManager.update(view.calculateExtent(size), resolution);
    }

    public destroy() {
        if (this.colorInterval !== null) {
            clearInterval(this.colorInterval);
            this.colorInterval = null;
        }
        if (this.moveEndKey) { unByKey(this.moveEndKey); this.moveEndKey = null; }
        this.tileManager?.clear();
        this.tileManager = null;
        this.unsubscribes.forEach(u => u());
        this.unsubscribes = [];
    }
}
