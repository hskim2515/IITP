import { Viewer } from "cesium";
import * as Cesium from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { useScenarioStore } from "@stores/useScenarioStore";
import { Network } from "@type/Network";
import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import { LOD_ALT, NETWORK_TILING, NETWORK_LOD_TIER_ORDER, getNetworkLodTierByResolution } from "@utils/lodConstants";
import axiosInstance from "@api/axiosInstance";
import { NetworkTileManager, type NetworkTilePayload } from "@managers/NetworkTileManager";
import { assignTileGuids } from "@utils/tileGuid";

// --- 이벤트 핸들러에서 Primitive 피킹/하이라이트에 사용 ---
export const networkPrimitivePropertiesMap = new Map<string, any>();
export let highlightNetworkPrimitive: ((guid: string | null) => void) | null = null;

/** 공간 청크 단위 Primitive 묶음 (3종 → 3 draw call per chunk) */
interface ChunkPrimitives {
    outline: Cesium.Primitive | null;  // 외곽 그림자 — link/outline LOD에서 표시
    link:    Cesium.Primitive | null;  // 아스팔트 링크 — link/full LOD에서 표시
    lane:    Cesium.Primitive | null;  // 레인+구분선+중앙선 합산 — full LOD에서만 표시
}

export default class NetworkDataSourceLayer {
    private readonly LAYER_NAME = "network";
    private dataSource: Cesium.CustomDataSource;

    /** 공간 청크 키(`lng_tile,lat_tile`) → Primitives */
    private chunkPrimitives: Map<string, ChunkPrimitives> = new Map();
    /** 청크 키 → 청크 중심 Cartesian3 (거리 컬링용) */
    private chunkCenters: Map<string, Cesium.Cartesian3> = new Map();

    /**
     * overview(원거리) 도로망 폴리라인 — 픽셀 굵기라 고도 무관 항상 가시.
     * 코리도(월드 폭)는 10km+ 고도에서 sub-pixel이 되어 안 보이므로,
     * outline LOD에서 이 폴리라인이 "도로망 지도"를 그린다. (OL link-edit 도로선의 3D 대응)
     */
    private roadOverviewPolylines: Cesium.PolylineCollection;

    // ── 타일링 상태 (NETWORK_TILING.ENABLED 일 때만; 읽기 전용 뷰) ──
    // 타일 격자 == 청크 격자(TILE_DEG==CHUNK_DEG)이므로 타일=청크로 1:1 매핑.
    // 각 링크/노드는 home 청크(첫 좌표 기준)에만 빌드 → 경계 중복 없음(refcount 불필요).
    private tileManager: NetworkTileManager | null = null;
    private tilePolylines: Map<string, Cesium.Polyline[]> = new Map(); // tileKey → overview 폴리라인
    private tileCameraTimer: ReturnType<typeof setTimeout> | null = null;
    private applyVisDebounce: ReturnType<typeof setTimeout> | null = null; // 타일 다중 로드 시 applyVisibility 1회로 합침
    // 3D 줌아웃(overview/mid): 간선 중심선 폴리라인 1회 fetch (2D MVT 대응). near로 줌인하면 타일로 전환.
    private overviewArterialsActive = false;
    private overviewFetchSeq = 0;
    // 노드 엔티티(폴/표지판) 빌드 큐 — 타일당 ~40ms 동기 빌드를 rAF로 프레임당 1타일 분산(줌/pan 끊김 방지)
    private nodeBuildQueue = new Map<string, any[]>();
    private nodeBuildRaf: number | null = null;

    /** 청크 크기 (도) — 타일 격자와 단일 출처로 통일 (타일=청크 1:1 매핑 보장) */
    private static readonly CHUNK_DEG = NETWORK_TILING.TILE_DEG;

    // featureType별 가시성 상태
    private featureTypeVisible: Record<string, boolean> = {};
    private destroyed = false;

    // ── 색상 팔레트 ─────────────────────────────────────────────
    // 아스팔트 도로 기본 (외곽 → 메인 순)
    private static readonly COLOR_LINK_OUTLINE = Cesium.Color.fromBytes(30, 30, 35, 200);   // 외곽 그림자
    private static readonly COLOR_LINK_BASE    = Cesium.Color.fromBytes(72, 74, 80, 235);   // 도로 기본

    // 레인 교차 음영 (짝/홀)
    private static readonly LANE_COLORS = [
        Cesium.Color.fromBytes(62, 64, 70, 255),
        Cesium.Color.fromBytes(84, 86, 94, 255),
    ];

    // 도로 타입별 색조 (link.type 기준)
    private static readonly LINK_TYPE_COLOR: Record<string, Cesium.Color> = {
        'highway':    Cesium.Color.fromBytes(70, 60, 30, 245),   // 고속도로 — 황토
        'motorway':   Cesium.Color.fromBytes(70, 60, 30, 245),
        'trunk':      Cesium.Color.fromBytes(60, 55, 35, 245),   // 주간선 — 황갈색
        'primary':    Cesium.Color.fromBytes(55, 52, 40, 245),   // 1차로 — 진한 회갈
        'secondary':  Cesium.Color.fromBytes(50, 52, 50, 245),   // 2차로
        'local':      Cesium.Color.fromBytes(46, 48, 50, 245),   // 이면도로
        'ramp':       Cesium.Color.fromBytes(48, 55, 38, 245),   // 램프 — 녹색조
    };

    // 차선 구분선 (경계)
    private static readonly COLOR_DIVIDER      = Cesium.Color.fromBytes(190, 190, 190, 200);  // 흰색 실선
    // 중앙선
    private static readonly COLOR_CENTER_LINE  = Cesium.Color.fromBytes(220, 180, 40, 220);   // 황색 중앙선

    private unsubscribe: (() => void) | undefined;
    private unsubscribeDraw: (() => void) | undefined;
    private static readonly EPSILON = 1e-9;
    private selectedScenario = useScenarioStore.getState().selectedScenario;

    private static readonly LOD_LINK_ONLY    = LOD_ALT.NETWORK_LINK_ONLY;
    private static readonly LOD_OUTLINE_ONLY = LOD_ALT.NETWORK_OUTLINE_ONLY;
    private _layerVisible: boolean = true;
    private currentLod: 'full' | 'link' | 'outline' = 'full';
    private cameraChangeUnsubscribe?: () => void;

    // 지형 고도 캐시 (lng,lat 소수점5자리 키 → 미터 고도)
    private terrainHeightMap = new Map<string, number>();
    private terrainKey(lng: number, lat: number) {
        return `${lng.toFixed(5)},${lat.toFixed(5)}`;
    }

    private hasRealTerrain(): boolean {
        return !(this.viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider);
    }

    /** 링크 좌표 전체에 대해 지형 고도를 일괄 샘플링해 terrainHeightMap에 저장 */
    private async sampleTerrainHeights(network: Network): Promise<void> {
        if (!this.hasRealTerrain()) {
            this.terrainHeightMap.clear();
            return;
        }
        const coordMap = new Map<string, Cesium.Cartographic>();
        for (const link of network.links) {
            if (!link.coordinates) continue;
            for (const c of link.coordinates) {
                const key = this.terrainKey(c.lng, c.lat);
                if (!coordMap.has(key)) {
                    coordMap.set(key, Cesium.Cartographic.fromDegrees(c.lng, c.lat));
                }
            }
        }
        const keys = Array.from(coordMap.keys());
        const cartos = Array.from(coordMap.values());
        try {
            await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, cartos);
            this.terrainHeightMap.clear();
            for (let i = 0; i < keys.length; i++) {
                this.terrainHeightMap.set(keys[i]!, cartos[i]!.height ?? 0);
            }
        } catch (e) {
            console.warn("NetworkDataSourceLayer: 지형 고도 샘플링 실패", e);
            this.terrainHeightMap.clear();
        }
    }

    // 증분 업데이트 상태
    private prevNetwork: Network | null = null;
    private lastImportEpoch = 0;
    private fullBuildGeneration = 0;
    private cachedNodeMap: Map<string, any> = new Map();
    private cachedLinkMap: Map<string, any> = new Map();
    private lanePositionMap: Map<string, { source: Cesium.Cartesian3; target: Cesium.Cartesian3 }> = new Map();
    private nodeEntityIds: Map<string, string[]> = new Map();



    // 하이라이트 상태
    private highlightedGuid: string | null = null;
    private originalHighlightColor: Uint8Array | null = null;

    /** overview 도로망 폴리라인 색/굵기 */
    private static readonly COLOR_ROAD_OVERVIEW = Cesium.Color.fromBytes(236, 238, 245, 230);

    constructor(private viewer: Viewer) {
        this.dataSource = new Cesium.CustomDataSource(this.LAYER_NAME);
        this.viewer.dataSources.add(this.dataSource);
        this.roadOverviewPolylines = new Cesium.PolylineCollection();
        this.viewer.scene.primitives.add(this.roadOverviewPolylines);

        highlightNetworkPrimitive = this.highlightInstance.bind(this);

        this.load();
        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {

            this.unsubscribe = store.subscribe(
                (state: { currentJsonData: Network }) => state.currentJsonData,
                () => { this.load(); },
                { equalityFn: (a: Network, b: Network) => a === b }
            );
        }

        this.unsubscribeDraw = useNetworkDrawStore.subscribe(
            (state, prevState) => {
                const wasDrawing = prevState.isActive || prevState.isConnectionActive;
                const isDrawing = state.isActive || state.isConnectionActive;
                if (wasDrawing && !isDrawing) {
                    // draw 종료 시 fullBuild로 정리 (incremental 누적 후 일관성 보장)
                    this.prevNetwork = null;
                    this.load();
                }
            }
        );

        // 카메라 고도 기반 LOD
        const onCameraChange = () => this.onCameraChange();
        this.viewer.camera.changed.addEventListener(onCameraChange);
        this.cameraChangeUnsubscribe = () => this.viewer.camera.changed.removeEventListener(onCameraChange);
        this.currentLod = this.calcLod();
    }

    // ─────────────────────────────────────────────
    // LOD (Level of Detail)
    // ─────────────────────────────────────────────
    private calcLod(): 'full' | 'link' | 'outline' {
        const alt = this.viewer.camera.positionCartographic.height;
        if (alt > NetworkDataSourceLayer.LOD_OUTLINE_ONLY) return 'outline';
        if (alt > NetworkDataSourceLayer.LOD_LINK_ONLY)    return 'link';
        return 'full';
    }

    private onCameraChange(): void {
        const newLod = this.calcLod();
        this.currentLod = newLod;
        this.applyVisibility();
        try { this.viewer.scene.requestRender(); } catch (_) {}

        // 타일 모드: 카메라 정착 후(디바운스) viewport 타일 갱신
        if (NETWORK_TILING.ENABLED) {
            if (this.tileCameraTimer) return;
            this.tileCameraTimer = setTimeout(() => {
                this.tileCameraTimer = null;
                this.updateTiles();
            }, 200);
        }
    }

    // ─────────────────────── 타일 모드 (읽기 전용, Cesium) ───────────────────────
    // ⚠️ 편집은 전체-로드 경로 전제. 타일은 합성 guid 기반 뷰 전용.

    /** 화면 중앙 지면점 기준 거리 LOD + 그 주변 bbox → 타일 매니저 갱신.
     *  computeViewRectangle 은 카메라를 기울이면 지평선까지 포함해 폭이 폭발(→ tier 오판/거대 bbox)하므로
     *  사용하지 않는다. 대신 "화면 중앙에서 보는 지점까지 거리"로 판단해 기울임에 강건하게. */
    private updateTiles(): void {
        if (!NETWORK_TILING.ENABLED) return;
        const scene = this.viewer.scene;
        const camera = this.viewer.camera;
        const canvas = scene.canvas;

        // 화면 중앙 ray → 지면(globe) 교차점. 하늘을 보면(교차 없음) 네트워크 숨김 + 회수.
        const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
        const ray = camera.getPickRay(center);
        const ground = ray ? scene.globe.pick(ray, scene) : undefined;
        if (!ground) {
            this.tileManager?.clear();
            if (this.overviewArterialsActive) { this.overviewArterialsActive = false; this.roadOverviewPolylines.removeAll(); }
            return;
        }

        // 화면 중앙 1px이 덮는 지면 거리(m/px) = 2D OL resolution 과 동일 단위 → tier 기준 일치.
        //   pixelSize = (2·d·tan(fovy/2)) / canvasHeight
        const groundDist = Cesium.Cartesian3.distance(camera.positionWC, ground);
        const frustum: any = camera.frustum;
        const fovy = frustum.fovy ?? frustum.fov ?? Cesium.Math.toRadians(60);
        const canvasH = canvas.clientHeight || 900;
        const canvasW = canvas.clientWidth || 1200;
        const pixelSizeM = (2 * groundDist * Math.tan(fovy / 2)) / canvasH;
        const lod = getNetworkLodTierByResolution(pixelSizeM);

        // bbox: 화면 중앙 지면점 ± (실제 화면이 덮는 지면 절반) — 가로/세로 픽셀 반영, 거대 bbox 방지.
        const halfHeightM = pixelSizeM * canvasH / 2;
        const halfWidthM  = pixelSizeM * canvasW / 2;
        const carto = Cesium.Cartographic.fromCartesian(ground);
        const centerLng = Cesium.Math.toDegrees(carto.longitude);
        const centerLat = Cesium.Math.toDegrees(carto.latitude);
        const halfLatDeg = halfHeightM / 111320;
        const halfLngDeg = (halfWidthM / 111320) / Math.max(Math.cos(carto.latitude), 0.01);
        const west = centerLng - halfLngDeg, east = centerLng + halfLngDeg;
        const south = centerLat - halfLatDeg, north = centerLat + halfLatDeg;

        const versionId = useScenarioStore.getState().selectedScenario?.key;
        if (!versionId) return;

        // 줌아웃(overview/mid): Cesium은 MVT를 못 쓰므로, viewport 간선 중심선을 1회 fetch해
        // roadOverviewPolylines로 표시 (2D MVT 대응). 줌인(near 이상)하면 타일 청크로 전환.
        const tierOrder = NETWORK_LOD_TIER_ORDER[lod as keyof typeof NETWORK_LOD_TIER_ORDER] ?? 99;
        if (tierOrder < NETWORK_LOD_TIER_ORDER.near) {
            this.tileManager?.clear();        // 타일 청크 evict (줌아웃)
            this.fetchOverviewArterials(String(versionId), west, south, east, north);
            return;
        }

        // near 이상: 간선 폴리라인 비우고 타일 청크로
        if (this.overviewArterialsActive) {
            this.overviewArterialsActive = false;
            this.roadOverviewPolylines.removeAll();
        }
        if (!this.tileManager) {
            this.tileManager = new NetworkTileManager(String(versionId), {
                onTileLoaded: (key, payload) => this.addTileChunk(key, payload),
                onTileEvicted: (key, payload) => this.removeTileChunk(key, payload),
            });
        }
        this.tileManager.updateForBbox(west, south, east, north, lod);
    }

    /** 줌아웃 시 viewport 간선(overview lod) 중심선을 1회 fetch → roadOverviewPolylines */
    private fetchOverviewArterials(versionId: string, w: number, s: number, e: number, n: number): void {
        const seq = ++this.overviewFetchSeq;
        axiosInstance.get(`/network/${versionId}/tiles`, { params: { bbox: `${w},${s},${e},${n}`, lod: 'overview' } })
            .then((res) => {
                if (seq !== this.overviewFetchSeq || this.destroyed) return; // 더 최신 요청이 있으면 폐기
                const links = res.data?.links ?? [];
                this.roadOverviewPolylines.removeAll();
                for (const link of links) this.addRoadOverviewPolyline(link);
                this.overviewArterialsActive = true;
                this.scheduleApplyVisibility();
            })
            .catch((err) => {
                if (err?.response?.status !== 404) console.warn('[NetworkDataSourceLayer] overview 간선 fetch 실패', err);
            });
    }

    /**
     * 타일 좌표의 지형 고도만 샘플링해 terrainHeightMap 에 누적(clear 없음).
     * 전체 로드용 sampleTerrainHeights 는 매번 clear 라 타일 모드엔 부적합 → 타일별 누적 버전.
     * 이미 캐시된 좌표는 재요청 안 함 → 점진적으로 채워짐(원격 요청 최소화).
     */
    private async sampleTerrainForTile(links: any[]): Promise<void> {
        if (!this.hasRealTerrain()) return;
        const coordMap = new Map<string, Cesium.Cartographic>();
        for (const link of links) {
            if (!link.coordinates) continue;
            for (const c of link.coordinates) {
                const key = this.terrainKey(c.lng, c.lat);
                if (!this.terrainHeightMap.has(key) && !coordMap.has(key)) {
                    coordMap.set(key, Cesium.Cartographic.fromDegrees(c.lng, c.lat));
                }
            }
        }
        if (coordMap.size === 0) return;
        const keys = Array.from(coordMap.keys());
        const cartos = Array.from(coordMap.values());
        try {
            await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, cartos);
            for (let i = 0; i < keys.length; i++) this.terrainHeightMap.set(keys[i]!, cartos[i]!.height ?? 0);
        } catch (e) {
            console.warn('[NetworkDataSourceLayer] 타일 지형 샘플링 실패', e);
        }
    }

    /** 타일 키와 일치하는(home) 링크/노드만 청크 프리미티브로 빌드 → 경계 중복 없음 */
    private async addTileChunk(tileKey: string, payload: NetworkTilePayload): Promise<void> {
        if (this.chunkPrimitives.has(tileKey)) return; // 이미 빌드됨
        assignTileGuids(payload);

        // cached 맵 병합 (노드/링크 상호참조용)
        for (const node of payload.nodes) this.cachedNodeMap.set(String(node.id), node);
        for (const link of payload.links) this.cachedLinkMap.set(String(link.id), link);

        // 빌드 전 지형 고도 샘플링(누적) → 도로가 고도 0이 아닌 실제 지형 위에 그려짐(지면 관통 방지).
        await this.sampleTerrainForTile(payload.links);
        if (this.chunkPrimitives.has(tileKey)) return;        // await 중 다른 경로가 이미 빌드
        if (this.tileManager && !this.tileManager.hasTile(tileKey)) return; // await 중 evict됨 → 좀비 방지

        // home 링크만(첫 좌표 기준 청크키 == 타일키) → 청크 인스턴스 빌드
        const outlineInst: Cesium.GeometryInstance[] = [];
        const linkInst: Cesium.GeometryInstance[] = [];
        const laneInst: Cesium.GeometryInstance[] = [];
        const polylines: Cesium.Polyline[] = [];
        for (const link of payload.links) {
            if (this.linkChunkKey(link) !== tileKey) continue;
            this.buildLinkInstances(link, this.cachedNodeMap, outlineInst, linkInst, laneInst, laneInst, laneInst);
            const pl = this.addRoadOverviewPolyline(link);
            if (pl) polylines.push(pl);
        }
        this.buildChunkPrimitives(tileKey, outlineInst, linkInst, laneInst);
        if (polylines.length > 0) this.tilePolylines.set(tileKey, polylines);
        // 노드 엔티티(폴/표지판)는 타일당 ~40ms 동기 빌드라 여러 타일 동시 로드 시 끊김.
        // 큐에 등록해 rAF로 프레임당 1타일씩 분산 (도로/차선은 위에서 즉시, 노드는 점진적).
        const homeNodes = payload.nodes.filter(nd => this.nodeChunkKey(nd) === tileKey);
        if (homeNodes.length > 0) {
            this.nodeBuildQueue.set(tileKey, homeNodes);
            this.scheduleNodeBuild();
        }

        // applyVisibility 는 전체 청크 순회(거리 컬링)라 타일마다 호출하면 O(N²) → 끊김.
        // 여러 타일이 동시에 로드될 때 debounce 로 1회만 실행.
        this.scheduleApplyVisibility();
    }

    /** 노드 엔티티 빌드를 rAF로 프레임당 1타일씩 처리 (메인스레드 양보 → 줌/pan 부드럽게) */
    private scheduleNodeBuild(): void {
        if (this.nodeBuildRaf != null) return;
        this.nodeBuildRaf = requestAnimationFrame(() => {
            this.nodeBuildRaf = null;
            const next = this.nodeBuildQueue.entries().next();
            if (!next.done) {
                const [tileKey, nodes] = next.value;
                this.nodeBuildQueue.delete(tileKey);
                // 청크가 아직 살아있을 때만 빌드 (그 사이 evict됐으면 스킵)
                if (this.chunkPrimitives.has(tileKey)) {
                    this.dataSource.entities.suspendEvents();
                    try {
                        for (const nd of nodes) {
                            try { this.buildNodeEntities(nd, this.cachedLinkMap, this.cachedNodeMap); }
                            catch (e) { console.warn('[NetworkDataSourceLayer] 타일 노드 빌드 건너뜀', nd?.id, e); }
                        }
                    } finally {
                        this.dataSource.entities.resumeEvents();
                    }
                    this.scheduleApplyVisibility();
                    try { this.viewer.scene.requestRender(); } catch (_) {}
                }
            }
            if (this.nodeBuildQueue.size > 0) this.scheduleNodeBuild();
        });
    }

    /** applyVisibility 를 debounce (다중 타일 로드를 1회로 합쳐 3D 끊김 완화) */
    private scheduleApplyVisibility(): void {
        if (this.applyVisDebounce) return;
        this.applyVisDebounce = setTimeout(() => {
            this.applyVisDebounce = null;
            this.applyVisibility();
            try { this.viewer.scene.requestRender(); } catch (_) {}
        }, 80);
    }

    /** 타일 청크 evict → 프리미티브/폴리라인/노드 엔티티 제거 */
    private removeTileChunk(tileKey: string, payload?: NetworkTilePayload): void {
        this.nodeBuildQueue.delete(tileKey); // 빌드 대기 중이던 노드 취소
        const chunk = this.chunkPrimitives.get(tileKey);
        if (chunk) {
            if (chunk.outline) this.viewer.scene.primitives.remove(chunk.outline);
            if (chunk.link)    this.viewer.scene.primitives.remove(chunk.link);
            if (chunk.lane)    this.viewer.scene.primitives.remove(chunk.lane);
            this.chunkPrimitives.delete(tileKey);
            this.chunkCenters.delete(tileKey);
        }
        const pls = this.tilePolylines.get(tileKey);
        if (pls) {
            for (const pl of pls) { try { this.roadOverviewPolylines.remove(pl); } catch (_) {} }
            this.tilePolylines.delete(tileKey);
        }
        // 노드 엔티티 제거: payload.nodes 의 home 노드를 id로 직접 제거 (cachedNodeMap 역추적 의존 X).
        // 역추적은 cachedNodeMap에서 node가 사라졌으면 매칭 실패 → 좀비 엔티티 누적 위험이 있었음.
        const homeNodes = payload?.nodes?.filter(nd => this.nodeChunkKey(nd) === tileKey) ?? [];
        for (const nd of homeNodes) {
            const nodeId = String(nd.id);
            const ids = this.nodeEntityIds.get(nodeId);
            if (ids) {
                for (const id of ids) {
                    const ent = this.dataSource.entities.getById(id);
                    if (ent) this.dataSource.entities.remove(ent);
                }
                this.nodeEntityIds.delete(nodeId);
            }
            this.cachedNodeMap.delete(nodeId);
        }
        // home 링크 캐시 정리 (payload 기준)
        for (const link of payload?.links ?? []) {
            if (this.linkChunkKey(link) === tileKey) this.cachedLinkMap.delete(String(link.id));
        }
        try { this.viewer.scene.requestRender(); } catch (_) {}
    }

    /** 노드 home 청크 키 (좌표 기준) */
    private nodeChunkKey(node: any): string {
        const c = node.coordinates;
        if (!c || c.lng == null || c.lat == null) return '0,0';
        return `${Math.floor(c.lng / NetworkDataSourceLayer.CHUNK_DEG)},${Math.floor(c.lat / NetworkDataSourceLayer.CHUNK_DEG)}`;
    }

    private applyVisibility(): void {
        const layer  = this._layerVisible;
        const linkFT = this.featureTypeVisible['links'] ?? true;
        const laneFT = this.featureTypeVisible['lanes'] ?? true;
        const lod    = this.currentLod;

        const camPos = this.viewer.scene.camera.positionWC;

        // 청크 컬링 반경 (LOD에 따라 다름)
        // outline(고도 10km+): 전체 표시 — link primitive 숨겨져 있어 부하 작음
        // link(3-10km): 링크만 25km 반경
        // full(0-3km): 링크 15km / 레인 8km 반경
        const LINK_R  = lod === 'outline' ? Infinity : (lod === 'link' ? 25000 : 15000);
        const LANE_R  = 8000;
        const LINK_R2 = LINK_R * LINK_R;
        const LANE_R2 = LANE_R * LANE_R;

        for (const [key, chunk] of this.chunkPrimitives) {
            const center = this.chunkCenters.get(key);
            let inLinkRange = true;
            let inLaneRange = false;

            if (center && isFinite(LINK_R)) {
                const dx = camPos.x - center.x;
                const dy = camPos.y - center.y;
                const dz = camPos.z - center.z;
                const d2 = dx*dx + dy*dy + dz*dz;
                inLinkRange = d2 <= LINK_R2;
                inLaneRange = d2 <= LANE_R2;
            } else {
                inLaneRange = true;
            }

            if (chunk.outline) chunk.outline.show = layer && linkFT && inLinkRange;
            if (chunk.link)    chunk.link.show    = layer && linkFT && inLinkRange && lod !== 'outline';
            if (chunk.lane)    chunk.lane.show    = layer && laneFT && lod === 'full' && inLaneRange;
        }

        // overview 도로망 폴리라인: 비타일 모드는 outline LOD(원거리), 타일 모드는 줌아웃 간선 fetch 활성 시.
        this.roadOverviewPolylines.show = layer && linkFT && (lod === 'outline' || this.overviewArterialsActive);

        this.dataSource.show = layer && lod === 'full';
        this.viewer.scene.globe.depthTestAgainstTerrain = !layer;
    }

    // ─────────────────────────────────────────────
    // Primitive 하이라이트 (이벤트 핸들러에서 호출)
    // ─────────────────────────────────────────────
    private highlightInstance(guid: string | null): void {
        // 이전 하이라이트 복원 — 모든 청크의 link/lane Primitive에서 검색
        if (this.highlightedGuid && this.originalHighlightColor) {
            const prevColor = this.originalHighlightColor;
            const prevGuid  = this.highlightedGuid;
            for (const chunk of this.chunkPrimitives.values()) {
                let found = false;
                for (const p of [chunk.link, chunk.lane]) {
                    if (!p?.ready) continue;
                    try {
                        const attrs = p.getGeometryInstanceAttributes(prevGuid);
                        if (attrs) { attrs.color = prevColor; found = true; break; }
                    } catch (_) {}
                }
                if (found) break;
            }
        }
        this.highlightedGuid = null;
        this.originalHighlightColor = null;

        if (guid) {
            outer: for (const chunk of this.chunkPrimitives.values()) {
                for (const p of [chunk.link, chunk.lane]) {
                    if (!p?.ready) continue;
                    try {
                        const attrs = p.getGeometryInstanceAttributes(guid);
                        if (attrs?.color) {
                            this.originalHighlightColor = new Uint8Array(attrs.color);
                            attrs.color = Cesium.ColorGeometryInstanceAttribute.toValue(Cesium.Color.YELLOW.withAlpha(0.9));
                            try { this.viewer.scene.requestRender(); } catch (_) {}
                            break outer;
                        }
                    } catch (_) {}
                }
            }
        }
        this.highlightedGuid = guid;
    }

    // ─────────────────────────────────────────────
    // 진입점
    // ─────────────────────────────────────────────
    public load(): void {
        // 타일 모드: store 기반 전체 빌드를 하지 않는다 (타일 매니저가 viewport 청크만 빌드).
        if (NETWORK_TILING.ENABLED) { this.updateTiles(); return; }
        const store = layerNameToStoreMap[this.LAYER_NAME];
        let network: Network | undefined = store?.getState().currentJsonData;
        if (!network || !network.nodes || !network.links) {
            console.warn('[NetworkDataSourceLayer.load] 데이터 없음 또는 구조 불일치', network ? Object.keys(network) : 'null');
            // OL(NetworkFeatureLayer)과 동일하게 빈 네트워크로 취급하여
            // fullBuild를 통해 이전 Primitive를 정리한다 (그렇지 않으면 구 네트워크가 화면에 잔존함)
            network = { id: 0, name: null, nodes: [], links: [] };
        }

        if (!this.prevNetwork || this.isFullReplace(this.prevNetwork, network)) {
            this.fullBuild(network).catch(e => console.error("NetworkDataSourceLayer.fullBuild 에러:", e));
        } else {
            this.incrementalUpdate(this.prevNetwork, network);
        }
        this.prevNetwork = network;
    }

    private isFullReplace(prev: Network, next: Network): boolean {
        const store = layerNameToStoreMap[this.LAYER_NAME];
        const currentEpoch = (store?.getState() as any)?.importEpoch ?? 0;
        if (currentEpoch > this.lastImportEpoch) {
            this.lastImportEpoch = currentEpoch;
            return true;
        }
        if (!prev.links?.length || !next.links?.length) return true;

        // Fast path: 첫 링크 참조가 동일 → 증분 변경
        if (next.links.length >= prev.links.length && next.links[0] === prev.links[0]) {
            return false;
        }

        // Slow path: 공통 ID가 없으면 전체 교체
        const hasCommon = next.links.some(l => this.cachedLinkMap.has(String(l.id)));
        return !hasCommon;
    }

    // ─────────────────────────────────────────────
    // 전체 재빌드
    // ─────────────────────────────────────────────
    private async fullBuild(network: Network): Promise<void> {
        const generation = ++this.fullBuildGeneration;

        // 이전 네트워크를 즉시 제거 (지형 샘플링 전에 화면 클리어)
        this.removeAllChunkPrimitives();
        this.viewer.dataSources.remove(this.dataSource, true);
        this.dataSource = new Cesium.CustomDataSource(this.LAYER_NAME);
        this.viewer.dataSources.add(this.dataSource);

        // 지형 고도 샘플링 (지형 없으면 즉시 반환)
        await this.sampleTerrainHeights(network);

        // await 이후 destroy되었거나 더 새로운 fullBuild가 시작된 경우 중단
        if (this.destroyed || generation !== this.fullBuildGeneration) return;

        this.nodeEntityIds.clear();
        this.lanePositionMap.clear();
        networkPrimitivePropertiesMap.clear();

        this.cachedNodeMap = new Map(network.nodes.map(n => [String(n.id), n]));
        this.cachedLinkMap = new Map(network.links.map(l => [String(l.id), l]));

        // 링크·레인 → 공간 청크별 Primitive
        const chunkOutline = new Map<string, Cesium.GeometryInstance[]>();
        const chunkLink    = new Map<string, Cesium.GeometryInstance[]>();
        const chunkLane    = new Map<string, Cesium.GeometryInstance[]>(); // lane+divider+center 합산

        this.roadOverviewPolylines.removeAll();
        for (const link of network.links) {
            const key = this.linkChunkKey(link);
            if (!chunkOutline.has(key)) {
                chunkOutline.set(key, []); chunkLink.set(key, []); chunkLane.set(key, []);
            }
            const laneArr = chunkLane.get(key)!;
            this.buildLinkInstances(link, this.cachedNodeMap,
                chunkOutline.get(key)!, chunkLink.get(key)!, laneArr, laneArr, laneArr);
            this.addRoadOverviewPolyline(link);
        }
        for (const key of chunkOutline.keys()) {
            this.buildChunkPrimitives(key, chunkOutline.get(key)!, chunkLink.get(key)!, chunkLane.get(key)!);
        }

        // 노드·포트·커넥션 → DataSource Entity
        // suspendEvents()+removeAll()은 렌더 틱과 race를 일으켜
        // StaticGroundPolylinePerMaterialBatch 내부 _items에 undefined 슬롯을 만든다.
        // viewer에서 완전히 제거 후 새 DataSource로 교체하면 배치 오염이 없다.
        this.viewer.dataSources.remove(this.dataSource, true);
        this.dataSource = new Cesium.CustomDataSource(this.LAYER_NAME);
        for (const node of network.nodes) {
            try {
                this.buildNodeEntities(node, this.cachedLinkMap, this.cachedNodeMap);
            } catch (e) {
                console.warn('[NetworkDataSourceLayer] buildNodeEntities 건너뜀:', node?.id, e);
            }
        }
        this.viewer.dataSources.add(this.dataSource);
        // LOD + 레이어 가시성 일괄 적용 (depthTestAgainstTerrain 포함)
        this.applyVisibility();
        try { this.viewer.scene.requestRender(); } catch (_) {}
    }

    /** overview 도로망 폴리라인 1개 추가 (링크 중심선, 픽셀 굵기 + 차선수 비례). 생성된 Polyline 반환(타일 evict 추적용) */
    private addRoadOverviewPolyline(link: any): Cesium.Polyline | null {
        const coords = link.coordinates;
        if (!coords || coords.length < 2) return null;
        const positions = coords.map((c: any) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat));
        const laneCount = link.lanes?.length ?? 1;
        // 간선(차선 多)일수록 굵게, 최소 1px ~ 최대 3px
        const width = Math.max(1, Math.min(3, 0.8 + laneCount * 0.3));
        return this.roadOverviewPolylines.add({
            positions,
            width,
            material: Cesium.Material.fromType("Color", {
                color: NetworkDataSourceLayer.COLOR_ROAD_OVERVIEW,
            }),
        });
    }

    /** 링크 중심 좌표를 기반으로 청크 키 계산 */
    private linkChunkKey(link: any): string {
        const c = link.coordinates?.[0];
        if (!c) return '0,0';
        const cx = Math.floor(c.lng / NetworkDataSourceLayer.CHUNK_DEG);
        const cy = Math.floor(c.lat / NetworkDataSourceLayer.CHUNK_DEG);
        return `${cx},${cy}`;
    }

    /** 청크 하나의 Primitives 생성·등록 */
    private buildChunkPrimitives(
        key: string,
        outlineInst: Cesium.GeometryInstance[],
        linkInst:    Cesium.GeometryInstance[],
        laneInst:    Cesium.GeometryInstance[],
    ): void {
        this.highlightedGuid = null;
        this.originalHighlightColor = null;

        const appearance = () => new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true });
        const chunk: ChunkPrimitives = { outline: null, link: null, lane: null };

        if (outlineInst.length > 0) {
            chunk.outline = new Cesium.Primitive({ geometryInstances: outlineInst, appearance: appearance(), asynchronous: true });
            this.viewer.scene.primitives.add(chunk.outline);
        }
        if (linkInst.length > 0) {
            chunk.link = new Cesium.Primitive({ geometryInstances: linkInst, appearance: appearance(), asynchronous: true });
            this.viewer.scene.primitives.add(chunk.link);
        }
        if (laneInst.length > 0) {
            chunk.lane = new Cesium.Primitive({ geometryInstances: laneInst, appearance: appearance(), asynchronous: true });
            this.viewer.scene.primitives.add(chunk.lane);
        }

        this.chunkPrimitives.set(key, chunk);

        // 청크 중심 좌표 계산
        const [cx = 0, cy = 0] = key.split(',').map(Number);
        const centerLng = (cx + 0.5) * NetworkDataSourceLayer.CHUNK_DEG;
        const centerLat = (cy + 0.5) * NetworkDataSourceLayer.CHUNK_DEG;
        this.chunkCenters.set(key, Cesium.Cartesian3.fromDegrees(centerLng, centerLat));
    }

    /** 모든 청크 Primitive 제거 */
    private removeAllChunkPrimitives(): void {
        for (const chunk of this.chunkPrimitives.values()) {
            if (chunk.outline) this.viewer.scene.primitives.remove(chunk.outline);
            if (chunk.link)    this.viewer.scene.primitives.remove(chunk.link);
            if (chunk.lane)    this.viewer.scene.primitives.remove(chunk.lane);
        }
        this.chunkPrimitives.clear();
        this.chunkCenters.clear();
        this.highlightedGuid = null;
        this.originalHighlightColor = null;
    }

    /** 레이어 전체 on/off (DataSourceLayerManager에서 호출) */
    public setVisible(visible: boolean): void {
        this._layerVisible = visible;
        this.applyVisibility();
        try { this.viewer.scene.requestRender(); } catch (_) {}
    }

    /** 하위 featureType on/off (DataSourceLayerManager.toggleByFeatureType에서 호출) */
    public toggleFeatureTypeVisible(featureType: string, visible: boolean): void {
        this.featureTypeVisible[featureType] = visible;
        this.applyVisibility();
        try { this.viewer.scene.requestRender(); } catch (_) {}
    }

    // ─────────────────────────────────────────────
    // 증분 업데이트 (순수 append 시)
    // ─────────────────────────────────────────────
    private incrementalUpdate(prev: Network, next: Network): void {
        // 기존 링크 중 변경된 것이 있으면 fullBuild (#5 개선)
        const minLinkLen = Math.min(prev.links.length, next.links.length);
        for (let i = 0; i < minLinkLen; i++) {
            if (prev.links[i] !== next.links[i]) {
                this.fullBuild(next);
                return;
            }
        }

        const prevLastLinkIdx = prev.links.length - 1;
        const isPureAppend =
            next.links.length >= prev.links.length &&
            next.nodes.length >= prev.nodes.length &&
            prevLastLinkIdx >= 0 &&
            next.links[prevLastLinkIdx] === prev.links[prevLastLinkIdx];

        if (!isPureAppend) {
            this.fullBuild(next);
            return;
        }

        // 참조가 바뀐 기존 노드 수집
        const changedNodeIndices: number[] = [];
        const minNodeLen = Math.min(prev.nodes.length, next.nodes.length);
        for (let i = 0; i < minNodeLen; i++) {
            if (prev.nodes[i] !== next.nodes[i]) changedNodeIndices.push(i);
        }

        const newLinks = next.links.length > prev.links.length
            ? next.links.slice(prev.links.length) : [];
        const newNodes = next.nodes.length > prev.nodes.length
            ? next.nodes.slice(prev.nodes.length) : [];

        if (changedNodeIndices.length === 0 && newLinks.length === 0 && newNodes.length === 0) return;

        // 캐시 증분 갱신
        for (const i of changedNodeIndices) {
            const node = next.nodes[i]!;
            this.cachedNodeMap.set(String(node.id), node);
        }
        for (const node of newNodes) this.cachedNodeMap.set(String(node.id), node);
        for (const link of newLinks) this.cachedLinkMap.set(String(link.id), link);

        // 새 링크가 있으면 청크별 Primitive 전체 재빌드
        if (newLinks.length > 0) {
            networkPrimitivePropertiesMap.clear();
            this.lanePositionMap.clear();

            const chunkOutline = new Map<string, Cesium.GeometryInstance[]>();
            const chunkLink    = new Map<string, Cesium.GeometryInstance[]>();
            const chunkLane    = new Map<string, Cesium.GeometryInstance[]>();
            this.roadOverviewPolylines.removeAll();
            for (const link of next.links) {
                const key = this.linkChunkKey(link);
                if (!chunkOutline.has(key)) {
                    chunkOutline.set(key, []); chunkLink.set(key, []); chunkLane.set(key, []);
                }
                const laneArr = chunkLane.get(key)!;
                this.buildLinkInstances(link, this.cachedNodeMap,
                    chunkOutline.get(key)!, chunkLink.get(key)!, laneArr, laneArr, laneArr);
                this.addRoadOverviewPolyline(link);
            }
            this.removeAllChunkPrimitives();
            for (const key of chunkOutline.keys()) {
                this.buildChunkPrimitives(key, chunkOutline.get(key)!, chunkLink.get(key)!, chunkLane.get(key)!);
            }
            this.applyVisibility();
        }

        // 변경·추가된 노드의 Entity 처리
        this.dataSource.entities.suspendEvents();
        try {
            for (const node of newNodes) {
                this.buildNodeEntities(node, this.cachedLinkMap, this.cachedNodeMap);
            }
            for (const i of changedNodeIndices) {
                const prevNode = prev.nodes[i]!;
                const nextNode = next.nodes[i]!;
                const id = String(nextNode.id);
                const existingIds = this.nodeEntityIds.get(id) ?? [];

                // 추가된 port만 처리
                const newPorts = nextNode.ports.slice(prevNode.ports.length);
                for (const port of newPorts) {
                    const link = this.cachedLinkMap.get(String(port.linkId));
                    if (!link || !port.__guid || !link.coordinates?.length) continue;
                    // 링크 끝점 좌표 사용 (#4 개선)
                    const c0 = link.coordinates[0];
                    const cL = link.coordinates[link.coordinates.length - 1];
                    const srcPos = Cesium.Cartesian3.fromDegrees(c0.lng, c0.lat);
                    const tgtPos = Cesium.Cartesian3.fromDegrees(cL.lng, cL.lat);
                    this.dataSource.entities.add(new Cesium.Entity({
                        id: port.__guid,
                        position: port.type === 'in' ? tgtPos : srcPos,
                        cylinder: {
                            length: 2,
                            topRadius: port.type === 'in' ? 1.5 : 0.1,
                            bottomRadius: port.type === 'in' ? 0.1 : 1.5,
                            material: port.type === 'in'
                                ? Cesium.Color.CYAN.withAlpha(0.8)
                                : Cesium.Color.MAGENTA.withAlpha(0.8),
                            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                        },
                        properties: port,
                    }));
                    existingIds.push(port.__guid);
                }

                // 추가된 connection만 처리
                const newConns = nextNode.connections.slice(prevNode.connections.length);
                for (const conn of newConns) {
                    this.addConnectionEntity(conn, nextNode);
                    if (conn.__guid) existingIds.push(conn.__guid as string);
                }

                this.nodeEntityIds.set(id, existingIds);
            }
        } finally {
            this.dataSource.entities.resumeEvents();
            try { this.viewer.scene.requestRender(); } catch (_) {}
        }
    }

    // ─────────────────────────────────────────────
    // 링크·레인 GeometryInstance 생성
    // ─────────────────────────────────────────────
    /** link.type → 도로 색상 */
    private getLinkColor(link: any): Cesium.Color {
        const t = (link.type ?? '').toLowerCase();
        return NetworkDataSourceLayer.LINK_TYPE_COLOR[t]
            ?? NetworkDataSourceLayer.COLOR_LINK_BASE;
    }

    private buildLinkInstances(
        link: any,
        nodeMap: Map<string, any>,
        linkOutlineInstances: Cesium.GeometryInstance[],
        linkInstances: Cesium.GeometryInstance[],
        laneInstances: Cesium.GeometryInstance[],
        dividerInstances: Cesium.GeometryInstance[],
        centerLineInstances: Cesium.GeometryInstance[]
    ): void {
        const sourceNode = nodeMap.get(String(link.fromNode));
        const targetNode = nodeMap.get(String(link.toNode));
        if (!sourceNode || !targetNode || !link.lanes) return;
        if (!link.coordinates || link.coordinates.length < 2) return;
        if (!link.__guid) return; // GUID 미부여 링크는 스킵 (assignPropertyToResponseData 전 호출 방지)

        // 링크 좌표의 평균 지형 고도 계산
        let terrainSum = 0;
        let terrainCount = 0;
        for (const c of link.coordinates) {
            const h = this.terrainHeightMap.get(this.terrainKey(c.lng, c.lat));
            if (h !== undefined) { terrainSum += h; terrainCount++; }
        }
        const avgTerrainH = terrainCount > 0 ? terrainSum / terrainCount : 0;

        const H_OUTLINE  = avgTerrainH + 0.01;
        const H_LINK     = avgTerrainH + 0.02;
        const H_LANE     = avgTerrainH + 0.04;
        const H_DIVIDER  = avgTerrainH + 0.06;
        const H_CENTER   = avgTerrainH + 0.07;

        // 중간 좌표 모두 반영 (NaN·중복 좌표 제거 — Cesium WebGL 오류 방지)
        const MIN_LINK_DIST = 0.5;
        const validCoords = link.coordinates.filter(
            (c: any) => c && isFinite(c.lng) && isFinite(c.lat)
        );
        if (validCoords.length < 2) return;
        const rawLinkPos = validCoords.map((c: any) =>
            Cesium.Cartesian3.fromDegrees(c.lng, c.lat)
        );
        const linkPositions: Cesium.Cartesian3[] = [rawLinkPos[0]];
        for (let _i = 1; _i < rawLinkPos.length; _i++) {
            if (Cesium.Cartesian3.distance(rawLinkPos[_i], linkPositions[linkPositions.length - 1]) >= MIN_LINK_DIST)
                linkPositions.push(rawLinkPos[_i]);
        }
        if (linkPositions.length < 2) return;

        const roadWidth = link.width ?? 7;

        // ── 1. 외곽 그림자 (도로 폭보다 약간 크게, 어두운 색) ─────
        linkOutlineInstances.push(new Cesium.GeometryInstance({
            id: `${link.__guid}_outline`,
            geometry: new Cesium.CorridorGeometry({
                positions: linkPositions,
                width: roadWidth + 1.2,
                height: H_OUTLINE,
                cornerType: Cesium.CornerType.MITERED,
                vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
            }),
            attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                    NetworkDataSourceLayer.COLOR_LINK_OUTLINE
                ),
            },
        }));

        // ── 2. 아스팔트 도로 (타입별 색상) ───────────────────────
        const roadColor = this.getLinkColor(link);
        linkInstances.push(new Cesium.GeometryInstance({
            id: link.__guid,
            geometry: new Cesium.CorridorGeometry({
                positions: linkPositions,
                width: roadWidth,
                height: H_LINK,
                cornerType: Cesium.CornerType.MITERED,
                vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
            }),
            attributes: {
                color: Cesium.ColorGeometryInstanceAttribute.fromColor(roadColor),
            },
        }));
        networkPrimitivePropertiesMap.set(link.__guid, { ...link, featureType: "links" });

        const laneCount = link.lanes.length || 2;
        const laneWidth = roadWidth / laneCount;

        for (let i = 0; i < link.lanes.length; i++) {
            const lane = link.lanes[i];
            if (!lane) continue;
            const lateralOffset = ((laneCount - 1) / 2 - i) * laneWidth;

            const lanePositions = this.computeOffsetPositions(link.coordinates, lateralOffset);
            this.lanePositionMap.set(`${link.id}_${i}`, {
                source: lanePositions[0]!,
                target: lanePositions[lanePositions.length - 1]!,
            });

            // ── 3. 레인 교차 음영 ──────────────────────────────
            const laneColor = NetworkDataSourceLayer.LANE_COLORS[i % 2]!;
            laneInstances.push(new Cesium.GeometryInstance({
                id: lane.__guid,
                geometry: new Cesium.CorridorGeometry({
                    positions: lanePositions,
                    width: laneWidth * 0.94,
                    height: H_LANE,
                    cornerType: Cesium.CornerType.MITERED,
                    vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
                }),
                attributes: {
                    color: Cesium.ColorGeometryInstanceAttribute.fromColor(laneColor),
                },
            }));
            networkPrimitivePropertiesMap.set(lane.__guid, { ...lane, featureType: "lanes", linkRef: link.id });

            // ── 4. 차선 구분선 (흰색 실선, 마지막 레인 제외) ──
            if (i < link.lanes.length - 1 && lane.__guid) {
                const boundaryOffset = lateralOffset - laneWidth / 2;
                const boundaryPositions = this.computeOffsetPositions(link.coordinates, boundaryOffset);
                dividerInstances.push(new Cesium.GeometryInstance({
                    id: `${lane.__guid}_divider`,
                    geometry: new Cesium.CorridorGeometry({
                        positions: boundaryPositions,
                        width: Math.max(laneWidth * 0.055, 0.15),
                        height: H_DIVIDER,
                        cornerType: Cesium.CornerType.MITERED,
                        vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
                    }),
                    attributes: {
                        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                            NetworkDataSourceLayer.COLOR_DIVIDER
                        ),
                    },
                }));
            }
        }

        // ── 5. 중앙선 (황색, 양방향 도로의 경계) ──────────────
        // 레인이 2개 이상이고 중간 경계에 황색 중앙선 표시
        if (laneCount >= 2) {
            const centerPositions = this.computeOffsetPositions(link.coordinates, 0);
            centerLineInstances.push(new Cesium.GeometryInstance({
                id: `${link.__guid}_center`,
                geometry: new Cesium.CorridorGeometry({
                    positions: centerPositions,
                    width: Math.max(laneWidth * 0.04, 0.12),
                    height: H_CENTER,
                    cornerType: Cesium.CornerType.MITERED,
                    vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
                }),
                attributes: {
                    color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                        NetworkDataSourceLayer.COLOR_CENTER_LINE
                    ),
                },
            }));
        }
    }

    /**
     * 좌표 배열에 측방향 오프셋을 적용한 Cartesian3 배열 반환.
     * 각 점에서 지역 접선 방향과 타원체 법선으로 right 벡터를 계산해
     * 곡선 도로에서도 레인이 도로 폭 안에 정확히 위치한다. (#3 개선)
     */
    private computeOffsetPositions(coordinates: any[], lateralOffset: number): Cesium.Cartesian3[] {
        return coordinates.map((c: any, i: number) => {
            const curPos = Cesium.Cartesian3.fromDegrees(c.lng, c.lat);
            if (lateralOffset === 0) return curPos;

            const prev = coordinates[i - 1] ?? coordinates[i];
            const next = coordinates[i + 1] ?? coordinates[i];
            const prevPos = Cesium.Cartesian3.fromDegrees(prev.lng, prev.lat);
            const nextPos = Cesium.Cartesian3.fromDegrees(next.lng, next.lat);

            // 로컬 접선 방향 — 중복 좌표(zero vector)이면 오프셋 포기
            const diff = Cesium.Cartesian3.subtract(nextPos, prevPos, new Cesium.Cartesian3());
            const diffMag = Cesium.Cartesian3.magnitude(diff);
            if (diffMag < 1e-6) return curPos;
            const dir = Cesium.Cartesian3.divideByScalar(diff, diffMag, new Cesium.Cartesian3());

            // 타원체 법선 (up 벡터)
            const up = Cesium.Cartesian3.normalize(curPos, new Cesium.Cartesian3());
            // 수평면 내 right 벡터 = dir × up — 평행한 경우 오프셋 포기
            const rightRaw = Cesium.Cartesian3.cross(dir, up, new Cesium.Cartesian3());
            const rightMag = Cesium.Cartesian3.magnitude(rightRaw);
            if (rightMag < 1e-6) return curPos;
            const right = Cesium.Cartesian3.divideByScalar(rightRaw, rightMag, new Cesium.Cartesian3());

            return Cesium.Cartesian3.add(
                curPos,
                Cesium.Cartesian3.multiplyByScalar(right, lateralOffset, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );
        });
    }

    // ─────────────────────────────────────────────
    // 노드·포트·커넥션 Entity 생성
    // ─────────────────────────────────────────────
    private buildNodeEntities(node: any, linkMap: Map<string, any>, nodeMap: Map<string, any>): void {
        if (!node.coordinates?.lng || !node.coordinates?.lat) return;
        const ids: string[] = [];
        const position = Cesium.Cartesian3.fromDegrees(node.coordinates.lng, node.coordinates.lat);

        this.dataSource.entities.add(new Cesium.Entity({
            id: node.__guid,
            position,
            cylinder: {
                length: 5.0,
                topRadius: 0.5,
                bottomRadius: 0.5,
                material: Cesium.Color.YELLOW,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            properties: node,
        }));
        ids.push(node.__guid);

        for (const port of (node.ports ?? [])) {
            const link = linkMap.get(String(port.linkId));
            if (!link || !link.coordinates?.length || !port.__guid) continue;
            // 링크 시작/끝 좌표 사용 (노드 좌표 대신) (#4 개선)
            const c0 = link.coordinates[0];
            const cL = link.coordinates[link.coordinates.length - 1];
            const srcPos = Cesium.Cartesian3.fromDegrees(c0.lng, c0.lat);
            const tgtPos = Cesium.Cartesian3.fromDegrees(cL.lng, cL.lat);

            this.dataSource.entities.add(new Cesium.Entity({
                id: port.__guid,
                position: port.type === 'in' ? tgtPos : srcPos,
                cylinder: {
                    length: 2,
                    topRadius: port.type === 'in' ? 1.5 : 0.1,
                    bottomRadius: port.type === 'in' ? 0.1 : 1.5,
                    material: port.type === 'out'
                        ? Cesium.Color.CYAN.withAlpha(0.8)
                        : Cesium.Color.MAGENTA.withAlpha(0.8),
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                },
                properties: port,
            }));
            ids.push(port.__guid);
        }

        for (const conn of (node.connections ?? [])) {
            this.addConnectionEntity(conn, node);
            if (conn.__guid) ids.push(conn.__guid as string);
        }

        this.nodeEntityIds.set(String(node.id), ids);
    }

    private addConnectionEntity(conn: any, node: any): void {
        const fromLink = this.cachedLinkMap.get(String(conn.fromLink));
        const toLink = this.cachedLinkMap.get(String(conn.toLink));
        if (!fromLink || !toLink || !conn.__guid) return;

        let fromPt: Cesium.Cartesian3;
        let toPt: Cesium.Cartesian3;

        if (conn.coordinates?.length >= 2) {
            const c0 = conn.coordinates[0];
            const cL = conn.coordinates[conn.coordinates.length - 1];
            if (!c0 || !cL) return;
            fromPt = Cesium.Cartesian3.fromDegrees(c0.lng, c0.lat);
            toPt = Cesium.Cartesian3.fromDegrees(cL.lng, cL.lat);
        } else {
            const fromPos = this.lanePositionMap.get(`${String(fromLink.id)}_${conn.fromLane}`);
            const toPos = this.lanePositionMap.get(`${String(toLink.id)}_${conn.toLane}`);
            if (!fromPos || !toPos) return;
            fromPt = fromPos.target;
            toPt = toPos.source;
        }

        const ctrlPt = node.coordinates?.lng && node.coordinates?.lat
            ? Cesium.Cartesian3.fromDegrees(node.coordinates.lng, node.coordinates.lat)
            : Cesium.Cartesian3.midpoint(fromPt, toPt, new Cesium.Cartesian3());
        const positions = conn.turning === 'Straight'
            ? [fromPt, toPt]
            : this.generateQuadraticBezierCurve(fromPt, ctrlPt, toPt);

        this.dataSource.entities.add({
            id: conn.__guid as string,
            polyline: {
                positions,
                width: 5,
                arcType: Cesium.ArcType.GEODESIC,
                material: new Cesium.PolylineArrowMaterialProperty(Cesium.Color.WHITE.withAlpha(0.8)),
                clampToGround: true,
            },
            properties: conn,
        });
    }

    // ─────────────────────────────────────────────
    // 커넥션 베지어 곡선
    // ─────────────────────────────────────────────
    private getLineIntersectionPoint(
        p1: Cesium.Cartesian3, v1: Cesium.Cartesian3,
        p2: Cesium.Cartesian3, v2: Cesium.Cartesian3
    ): Cesium.Cartesian3 | null {
        const p1p2 = Cesium.Cartesian3.subtract(p1, p2, new Cesium.Cartesian3());
        const v1v1 = Cesium.Cartesian3.dot(v1, v1);
        const v2v2 = Cesium.Cartesian3.dot(v2, v2);
        const v1v2 = Cesium.Cartesian3.dot(v1, v2);
        const denominator = v1v2 * v1v2 - v1v1 * v2v2;
        if (Math.abs(denominator) < NetworkDataSourceLayer.EPSILON) return null;
        const t =
            (Cesium.Cartesian3.dot(p1p2, v1) * v2v2 - Cesium.Cartesian3.dot(p1p2, v2) * v1v2) /
            denominator;
        return Cesium.Cartesian3.add(
            p1,
            Cesium.Cartesian3.multiplyByScalar(v1, t, new Cesium.Cartesian3()),
            new Cesium.Cartesian3()
        );
    }

    private generateQuadraticBezierCurve(
        start: Cesium.Cartesian3,
        controlPoint: Cesium.Cartesian3,
        end: Cesium.Cartesian3,
        numPoints: number = 15,
        pullScale: number = 0.4
    ): Cesium.Cartesian3[] {
        const basePoint = Cesium.Cartesian3.multiplyByScalar(
            Cesium.Cartesian3.add(start, end, new Cesium.Cartesian3()),
            0.5,
            new Cesium.Cartesian3()
        );
        const pullVector = Cesium.Cartesian3.multiplyByScalar(
            Cesium.Cartesian3.subtract(controlPoint, basePoint, new Cesium.Cartesian3()),
            pullScale,
            new Cesium.Cartesian3()
        );
        const effectiveControl = Cesium.Cartesian3.add(basePoint, pullVector, new Cesium.Cartesian3());

        const points: Cesium.Cartesian3[] = [];
        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            const inv = 1 - t;
            const p0 = Cesium.Cartesian3.multiplyByScalar(start, inv * inv, new Cesium.Cartesian3());
            const p1 = Cesium.Cartesian3.multiplyByScalar(effectiveControl, 2 * inv * t, new Cesium.Cartesian3());
            const p2 = Cesium.Cartesian3.multiplyByScalar(end, t * t, new Cesium.Cartesian3());
            const pt = Cesium.Cartesian3.add(
                Cesium.Cartesian3.add(p0, p1, new Cesium.Cartesian3()),
                p2,
                new Cesium.Cartesian3()
            );
            points.push(pt);
        }
        return points;
    }

    // ─────────────────────────────────────────────
    // 정리
    // ─────────────────────────────────────────────
    public destroy(): void {
        this.destroyed = true;
        this.cameraChangeUnsubscribe?.();
        if (this.tileCameraTimer) { clearTimeout(this.tileCameraTimer); this.tileCameraTimer = null; }
        if (this.applyVisDebounce) { clearTimeout(this.applyVisDebounce); this.applyVisDebounce = null; }
        if (this.nodeBuildRaf != null) { cancelAnimationFrame(this.nodeBuildRaf); this.nodeBuildRaf = null; }
        this.nodeBuildQueue.clear();
        this.tileManager?.clear();
        this.tileManager = null;
        this.tilePolylines.clear();
        // 레이어 제거 시 지형 depth test 복원
        try { this.viewer.scene.globe.depthTestAgainstTerrain = true; } catch (_) {}
        this.unsubscribe?.();
        this.unsubscribeDraw?.();
        this.removeAllChunkPrimitives();
        try { this.viewer.scene.primitives.remove(this.roadOverviewPolylines); } catch (_) {}
        if (this.dataSource) {
            this.viewer.dataSources.remove(this.dataSource, true);
        }
        if (highlightNetworkPrimitive === this.highlightInstance) {
            highlightNetworkPrimitive = null;
        }
        networkPrimitivePropertiesMap.clear();
    }
}
