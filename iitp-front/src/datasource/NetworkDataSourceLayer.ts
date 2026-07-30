import { Viewer } from "cesium";
import { getActiveVersionId } from "@utils/versionId";
import * as Cesium from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { useScenarioStore } from "@stores/useScenarioStore";
import { Network } from "@type/Network";
import { useNetworkTileStore } from "@stores/useNetworkTileStore";
import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import { LOD_ALT, LOD_RES, NETWORK_TILING, NETWORK_LOD_TIER_ORDER, NETWORK_LOD_TIER_BY_ORDER, getNetworkLodTierByResolution, type NetworkLodTier } from "@utils/lodConstants";
import axiosInstance from "@api/axiosInstance";
import { NetworkTileManager, type NetworkTilePayload } from "@managers/NetworkTileManager";
import { assignTileGuids } from "@utils/tileGuid";
import { smoothSharpPolyline } from "@utils/polylineSmooth";
import { normalizeTurning } from "@utils/turning";
import { useNetworkEditStore } from "@stores/useNetworkEditStore";

// --- 이벤트 핸들러에서 Primitive 피킹/하이라이트에 사용 ---
// map/상수는 의존성 없는 공유 리프 모듈(networkPrimitiveShared)에 있다 — UI 유틸이 이 파일을
// 직접 import 하면 LayerManager 의 eager glob(@datasource/*)과 모듈 평가 사이클이 생기기 때문.
// (LayerManager 는 default export 우선으로 클래스를 등록하므로 보조 export 추가는 안전)
import { networkPrimitivePropertiesMap, NETWORK_HIGHLIGHT_DURATION_MS } from "@utils/networkPrimitiveShared";
// guid=링크 guid. laneIdx 지정 시 그 레인만(부모 링크 전체 아님) 하이라이트.
/** hover 전용 하이라이트 — 선택 슬롯(setNetworkSelectionHighlight)은 건드리지 않는다 */
export let highlightNetworkPrimitive: ((guid: string | null, laneIdx?: number) => void) | null = null;
/** 선택(그리드/클릭) 하이라이트 — hover 가 덮지 못하는 별도 슬롯, 5초 후 자동 만료 */
export let setNetworkSelectionHighlight: ((guid: string, laneIdx?: number) => void) | null = null;
export let clearNetworkSelectionHighlight: (() => void) | null = null;

/** 커서 지면점 (타원체 표면 height 0 으로 정규화 — 측방향 오프셋 계산용).
 *
 *  1순위 scene.pickPosition(깊이버퍼) — 커서 아래 "실제로 렌더된 표면"의 좌표라
 *  보이는 것과 정의상 일치. globe.pick(ray-지형 교차)은 지형 타일 미로딩 시
 *  지속 실패하고(updateTiles 주석 참고), pickEllipsoid(height 0)는 지형고도 h·
 *  카메라 기울기 θ에서 수평오차 h/tanθ 가 **카메라 방위 따라 회전**하며 생겨
 *  "선택이 보이는 도로에서 어긋나고 방향에 따라 도는" 원인이 된다. */
let lastGroundSource = 'none'; // 디버그용 (__netPickDebug)

function pickGroundPoint(scene: Cesium.Scene, position: Cesium.Cartesian2): Cesium.Cartesian3 | null {
    let ground: Cesium.Cartesian3 | undefined;
    try {
        if (scene.pickPositionSupported) {
            const p = scene.pickPosition(position);
            if (Cesium.defined(p)) { ground = p; lastGroundSource = 'pickPosition'; }
        }
    } catch (_) { /* noop */ }
    if (!ground) {
        const ray = scene.camera.getPickRay(position);
        ground = ray ? scene.globe.pick(ray, scene) : undefined;
        if (ground) lastGroundSource = 'globePick';
    }
    if (!ground) {
        ground = scene.camera.pickEllipsoid(position, scene.globe.ellipsoid);
        if (ground) lastGroundSource = 'ellipsoid';
    }
    if (!ground) { lastGroundSource = 'none'; return null; }
    const carto = Cesium.Cartographic.fromCartesian(ground);
    return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude);
}

/** groundPt → 폴리라인 최근접 세그먼트의 (거리 m, 우측 부호화 오프셋 m).
 *  right = dir × up — computeOffsetPositions 의 렌더 오프셋과 같은 규약 */
function nearestLateralToPolyline(coords: any[], groundPt: Cesium.Cartesian3): { dist: number; signed: number } | null {
    let bestD2 = Infinity, signed = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        const a = Cesium.Cartesian3.fromDegrees(coords[i].lng, coords[i].lat);
        const b = Cesium.Cartesian3.fromDegrees(coords[i + 1].lng, coords[i + 1].lat);
        const ab = Cesium.Cartesian3.subtract(b, a, new Cesium.Cartesian3());
        const len2 = Cesium.Cartesian3.magnitudeSquared(ab);
        if (len2 < 1e-6) continue;
        const ap = Cesium.Cartesian3.subtract(groundPt, a, new Cesium.Cartesian3());
        const t = Cesium.Math.clamp(Cesium.Cartesian3.dot(ap, ab) / len2, 0, 1);
        const proj = Cesium.Cartesian3.add(a,
            Cesium.Cartesian3.multiplyByScalar(ab, t, new Cesium.Cartesian3()), new Cesium.Cartesian3());
        const off = Cesium.Cartesian3.subtract(groundPt, proj, new Cesium.Cartesian3());
        const d2 = Cesium.Cartesian3.magnitudeSquared(off);
        if (d2 >= bestD2) continue;
        const up = Cesium.Cartesian3.normalize(proj, new Cesium.Cartesian3());
        const right = Cesium.Cartesian3.cross(
            Cesium.Cartesian3.normalize(ab, new Cesium.Cartesian3()), up, new Cesium.Cartesian3());
        const rightMag = Cesium.Cartesian3.magnitude(right);
        if (rightMag < 1e-6) continue;
        bestD2 = d2;
        signed = Cesium.Cartesian3.dot(off, right) / rightMag;
    }
    if (!isFinite(bestD2)) return null;
    return { dist: Math.sqrt(bestD2), signed };
}

/** 커서 지면점 기준 링크 기하 탐색 — scene.pick 을 쓰지 않는다.
 *
 *  GroundPrimitive 분류볼륨 pick 은 지형 고저 범위만큼 수직 확장된 볼륨의 **벽면**이
 *  카메라 기울기에 따라 도로 footprint 밖 픽셀에 걸려, "보이는 것과 선택되는 것이
 *  다른" 픽 불일치를 만든다 (tier 스왑 잔존 지오메트리도 동일 증상). 화면에 보이는
 *  도로는 coordinates 의 결정적 함수이므로, 등록된 링크 지오메트리에서
 *  렌더와 같은 규칙(중심선 중앙정렬 [-width/2, +width/2])으로 직접 탐색하면
 *  보이는 것 = 선택되는 것이 보장된다. */
export function pickNetworkAtPosition(
    scene: Cesium.Scene,
    position: Cesium.Cartesian2,
): { guid: string; props: any } | null {
    const groundPt = pickGroundPoint(scene, position);
    if (!groundPt) return null;
    const carto = Cesium.Cartographic.fromCartesian(groundPt);
    const gLng = Cesium.Math.toDegrees(carto.longitude);
    const gLat = Cesium.Math.toDegrees(carto.latitude);

    let best: { guid: string; props: any; score: number } | null = null;
    for (const [guid, props] of networkPrimitivePropertiesMap) {
        if (props?.featureType !== 'links') continue;
        const coords = props.coordinates;
        if (!coords || coords.length < 2 || !coords[0]) continue;
        // 빠른 기각: 시작점 거리 > 링크 길이 + 도달 여유 (평면 근사, 원거리 링크 대부분 컷)
        const dx = (gLng - coords[0].lng) * 88000, dy = (gLat - coords[0].lat) * 111000;
        const reach = (typeof props.length === 'number' ? props.length : 1e7) + (props.width ?? 7) + 20;
        if (dx * dx + dy * dy > reach * reach) continue;

        const near = nearestLateralToPolyline(coords, groundPt);
        if (!near) continue;
        const width = props.width ?? 7;
        const half = width / 2;
        // 렌더된 몸체 = 중심선 중앙정렬 [-w/2, +w/2] (+외곽 0.6m) — buildLinkInstances 의
        // computeOffsetPositions(validCoords, 0) 규약과 정합. (구 우측시프트 [0, width] 판정은
        // 반폭 어긋나 "도로 좌반 클릭 무시, 우측 바깥 클릭 오선택"의 원인이었음)
        if (near.signed < -half - 0.6 || near.signed > half + 0.6) continue;
        if (near.dist > width + 2) continue; // 끝점 밖 과도 이탈 기각
        const score = Math.abs(near.signed); // 몸체 중심(=중심선)에 가까운 링크 우선
        if (!best || score < best.score) best = { guid, props, score };
    }
    if ((globalThis as any).__netPickDebug) {
        console.log('[netPick]', {
            ground: lastGroundSource,
            lng: gLng.toFixed(6), lat: gLat.toFixed(6),
            hitLink: best?.props?.id ?? null,
            offsetFromCenter: best ? best.score.toFixed(2) : null,
        });
    }
    return best ? { guid: best.guid, props: best.props } : null;
}

/** 도로 몸체 클릭 지점의 레인 역산 — 레인 채움면은 시점 아티팩트로 렌더에서 제거되어
 *  직접 pick 이 불가하므로, 지면점의 중심선 대비 우측 오프셋으로 레인 인덱스를 계산한다.
 *  buildLinkInstances 의 오프셋 규칙(중앙정렬, (i - (laneCount-1)/2)*laneWidth, 차선0=최좌측)과 정합. */
export function pickLaneAtPosition(scene: Cesium.Scene, position: Cesium.Cartesian2, link: any): any | null {
    const lanes = link?.lanes ?? [];
    const coords = (link?.coordinates ?? []).filter((c: any) => c && isFinite(c.lng) && isFinite(c.lat));
    if (lanes.length === 0 || coords.length < 2) return null;

    const groundPt = pickGroundPoint(scene, position);
    if (!groundPt) return null;
    const near = nearestLateralToPolyline(coords, groundPt);
    if (!near) return null;

    const roadWidth = link.width ?? 7;
    const laneCount = lanes.length;
    const laneWidth = roadWidth / laneCount;
    const idx = Math.round(near.signed / laneWidth + (laneCount - 1) / 2); // 중앙정렬
    if (idx < 0 || idx >= laneCount) return null; // 몸체 밖 (외곽 그림자 등)
    const lane = lanes[idx];
    return lane ? { ...lane, _laneIdx: idx } : null; // _laneIdx: 하이라이트/셀 계산용 레인 인덱스
}

/** 공간 청크 단위 Primitive 묶음 (지형 클램프).
 *  구분선/중앙선은 corridor(면)가 아닌 GroundPolyline(픽셀 폭 선) — 0.1m급 초박형 corridor 는
 *  분류 섀도우볼륨이 시선각에 따라 슬리버로 투영되어 "카메라 방향 따라 형상이 바뀌는" 아티팩트 발생. */
interface ChunkPrimitives {
    outline: Cesium.GroundPrimitive | null;          // 외곽 그림자 — link/outline LOD에서 표시
    link:    Cesium.GroundPrimitive | null;          // 아스팔트 링크 — link/full LOD에서 표시
    lane:    Cesium.GroundPrimitive | null;          // 레인 면 — full LOD에서만 표시
    line:    Cesium.GroundPolylinePrimitive | null;  // 구분선(흰)+중앙선(황) — full LOD에서만 표시
}

export default class NetworkDataSourceLayer {
    private readonly LAYER_NAME = "network";
    private dataSource: Cesium.CustomDataSource;

    /** 공간 청크 키(`lng_tile,lat_tile`) → Primitives */
    private chunkPrimitives: Map<string, ChunkPrimitives> = new Map();
    /** 청크 키 → 청크 중심 Cartesian3 (거리 컬링용) */
    private chunkCenters: Map<string, Cesium.Cartesian3> = new Map();

    /**
     * overview(원거리) 도로망 중심선 — 픽셀 굵기라 고도 무관 항상 가시.
     * 코리도(월드 폭)는 10km+ 고도에서 sub-pixel이 되어 안 보이므로,
     * outline LOD에서 이 중심선이 "도로망 지도"를 그린다. (OL link-edit 도로선의 3D 대응)
     * GroundPolylinePrimitive(지형 클램프) 사용 — depthTestAgainstTerrain=true 에서도
     * 지형에 묻히지 않으면서, 땅속 오브젝트가 투과되어 보이는 문제(depth test off)를 없앤다.
     * add(버퍼 수집) → commit(1 primitive 생성) 패턴.
     */
    private roadOverviewPrimitive: Cesium.GroundPolylinePrimitive | null = null;
    private roadOverviewBuffer: Cesium.GeometryInstance[] = [];
    private roadOverviewShow = true;

    // ── 타일링 상태 (NETWORK_TILING.ENABLED 일 때만; 읽기 전용 뷰) ──
    // 타일 격자 == 청크 격자(TILE_DEG==CHUNK_DEG)이므로 타일=청크로 1:1 매핑.
    // 각 링크/노드는 home 청크(첫 좌표 기준)에만 빌드 → 경계 중복 없음(refcount 불필요).
    private tileManager: NetworkTileManager | null = null;
    // (타일별 개별 폴리라인 추적은 제거됨 — 중심선은 mid 베이스레이어가 전담, 타일은 청크 primitive만)
    /** tileKey → home 링크/노드 id (evict 정리용). manager가 payload를 드롭하므로 자체 추적 */
    private tileHomeIds: Map<string, { nodeIds: string[]; linkIds: string[] }> = new Map();
    /** 링크/노드 id → 빌드한(소유) 타일. home 타일이 안 로드된 경계 횡단 지오메트리를
     *  payload에 포함한 타일이 대신 빌드(claim)할 때 중복 빌드 방지용 */
    private linkOwnerTile: Map<string, string> = new Map();
    private nodeOwnerTile: Map<string, string> = new Map();
    /** linkId → 그 링크(fromLink/toLink)가 아직 캐시에 없어 대기 중인 커넥션 목록.
     *  addConnectionEntity가 인접 링크 미도착으로 스킵할 때 등록하고, 그 링크가 나중에
     *  cachedLinkMap 에 들어오는 시점(addTileChunk)에 재시도한다 — 안 하면 노드는 이미
     *  "빌드 완료"로 마킹돼(nodeEntityIds) 그 커넥션만 영구히 안 그려진다. */
    private pendingConnectionsByLink: Map<string, { conn: any; node: any }[]> = new Map();
    /** forceRefetchIfLoaded 로 재요청한 타일 키 — addTileChunk 가 소비(1회성)하며, 같은 tier로
     *  이미 빌드돼 있어도 재클레임을 위해 재빌드하도록 조기 return 가드를 우회시킨다. */
    private pendingForceRebuild: Set<string> = new Set();
    /** tileKey → 빌드된 tier 순서 (near=2/detail=3) — tier 승격 시 무공백 스왑 판단용 */
    private chunkTiers: Map<string, number> = new Map();
    /** fullBuild 산출물 존재 여부 — 타일 모드 load() 재진입 시 전면 wipe 를 모드 전환 때만 하도록 */
    private hasFullBuildArtifacts = false;
    /** globe.pick 실패(지형 미로딩) 시 updateTiles 재시도 타이머 */
    private pickRetryTimer: ReturnType<typeof setTimeout> | null = null;
    /** 마지막 updateTiles 의 pixelSize 기반 tier — 엔티티 표시 게이팅용 (alt 기반 currentLod 와 별개) */
    private lastPixelTier: NetworkLodTier | 'unknown' = 'unknown';
    /** 마지막으로 near 이상 tier 였던 시각 — 경계 플랩 시 전체 clear 방지 (히스테리시스) */
    private lastNearTs = 0;
    private tileCameraTimer: ReturnType<typeof setTimeout> | null = null;
    /** 타일 매니저가 바라보는 versionId — 세션 중 버전 전환 감지용 */
    private tileVersionId: string | null = null;
    /** 편집 델타 오버레이 프리미티브 (타일 모드에서 미저장 편집 링크의 새 형상 — 2D 오버레이의 3D 대응) */
    private editOverlayPrims: (Cesium.GroundPrimitive | Cesium.GroundPolylinePrimitive)[] = [];
    private unsubscribeEdit: (() => void) | undefined;
    private applyVisDebounce: ReturnType<typeof setTimeout> | null = null; // 타일 다중 로드 시 applyVisibility 1회로 합침
    // 3D 줌아웃(overview/mid): 간선 중심선 폴리라인 1회 fetch (2D MVT 대응). near로 줌인하면 타일로 전환.
    private overviewArterialsActive = false;
    private overviewFetchSeq = 0;
    /** 직전 overview fetch가 커버한 bbox(패딩 포함)+lod — 이 범위 안의 팬/줌인은 refetch 스킵 (7천개 폴리라인 재빌드 방지) */
    private overviewFetchedBbox: { w: number; s: number; e: number; n: number; lod: string } | null = null;
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
    private static readonly COLOR_LINK_OUTLINE = Cesium.Color.fromBytes(30, 30, 35, 255);   // 외곽 그림자
    private static readonly COLOR_LINK_BASE    = Cesium.Color.fromBytes(72, 74, 80, 255);   // 도로 기본

    // 레인 교차 음영 (짝/홀)
    private static readonly LANE_COLORS = [
        Cesium.Color.fromBytes(62, 64, 70, 255),
        Cesium.Color.fromBytes(84, 86, 94, 255),
    ];

    // 도로 타입별 색조 (link.type 기준)
    private static readonly LINK_TYPE_COLOR: Record<string, Cesium.Color> = {
        'highway':    Cesium.Color.fromBytes(70, 60, 30, 255),   // 고속도로 — 황토
        'motorway':   Cesium.Color.fromBytes(70, 60, 30, 255),
        'trunk':      Cesium.Color.fromBytes(60, 55, 35, 255),   // 주간선 — 황갈색
        'primary':    Cesium.Color.fromBytes(55, 52, 40, 255),   // 1차로 — 진한 회갈
        'secondary':  Cesium.Color.fromBytes(50, 52, 50, 255),   // 2차로
        'local':      Cesium.Color.fromBytes(46, 48, 50, 255),   // 이면도로
        'ramp':       Cesium.Color.fromBytes(48, 55, 38, 255),   // 램프 — 녹색조
    };

    // 차선 구분선 (경계)
    private static readonly COLOR_DIVIDER      = Cesium.Color.fromBytes(190, 190, 190, 255);  // 흰색 실선
    // 중앙선
    private static readonly COLOR_CENTER_LINE  = Cesium.Color.fromBytes(220, 180, 40, 255);   // 황색 중앙선

    private unsubscribe: (() => void) | undefined;
    private unsubscribeDraw: (() => void) | undefined;
    private unsubscribeTileMode: (() => void) | undefined;
    private unsubscribeChanged: (() => void) | undefined;
    private prevIsChanged = false;
    private static readonly EPSILON = 1e-9;
    private selectedScenario = useScenarioStore.getState().selectedScenario;

    private static readonly LOD_LINK_ONLY    = LOD_ALT.NETWORK_LINK_ONLY;
    private static readonly LOD_OUTLINE_ONLY = LOD_ALT.NETWORK_OUTLINE_ONLY;
    private _layerVisible: boolean = true;
    private currentLod: 'full' | 'link' | 'outline' = 'full';
    private cameraChangeUnsubscribe?: () => void;
    /** applyVisibility()가 노드/포트/커넥션 엔티티를 전부 제거한 상태인지 (재표시 시 재빌드 트리거용) */
    private entitiesHiddenByVisibility = false;

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

    /**
     * 도로가 실제로 앉아있는 고도를 가장 가까운 링크 정점의 캐시값에서 찾아 반환한다.
     * ⚠️ 차량(useSimulation.ts)이 예전엔 이 맵을 쓰지 않고 자기 웨이포인트로 지형을
     * 독립적으로 재조회했다 — 도로는 이 맵(링크 정점, ~1m 격자)으로 그려지는데 차량은
     * 전혀 다른 점(차선 오프셋 경로)을 전혀 다른 격자(~11m)로 조회하니, 아무리 스무딩해도
     * "도로 기준"과 근본적으로 다른 고도가 나와 차량이 도로 위/아래로 떴다 파묻혔다 했다
     * (실사용자 관찰 — "잘못된 방식"). 도로와 같은 소스를 쓰게 하려면 이 맵에서 조회해야
     * 한다. maxDistM 밖이면 null(호출측이 폴백 처리).
     */
    public getNearestTerrainHeight(lng: number, lat: number, maxDistM = 30): number | null {
        if (this.terrainHeightMap.size === 0) return null;
        const METERS_PER_DEG_LAT = 111000;
        const metersPerDegLng = 111000 * Math.cos(lat * Math.PI / 180);
        let bestDistSq = Infinity;
        let bestHeight: number | null = null;
        for (const [key, height] of this.terrainHeightMap) {
            const comma = key.indexOf(',');
            const kLng = Number(key.slice(0, comma));
            const kLat = Number(key.slice(comma + 1));
            const dx = (kLng - lng) * metersPerDegLng;
            const dy = (kLat - lat) * METERS_PER_DEG_LAT;
            const distSq = dx * dx + dy * dy;
            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                bestHeight = height;
            }
        }
        return bestDistSq <= maxDistM * maxDistM ? bestHeight : null;
    }

    // 증분 업데이트 상태
    private prevNetwork: Network | null = null;
    private lastImportEpoch = 0;
    private fullBuildGeneration = 0;
    private cachedNodeMap: Map<string, any> = new Map();
    private cachedLinkMap: Map<string, any> = new Map();
    private lanePositionMap: Map<string, { source: Cesium.Cartesian3; target: Cesium.Cartesian3 }> = new Map();
    private nodeEntityIds: Map<string, string[]> = new Map();



    // 하이라이트 상태 — 인스턴스 색 변조 대신 전용 오버레이 primitive (highlightInstance 참고)
    // hover 슬롯 (mousemove 마다 갱신)
    private highlightedGuid: string | null = null;
    private highlightPrimitive: Cesium.GroundPrimitive | null = null;
    // 선택 슬롯 (그리드/클릭 선택) — hover 가 덮지 않으며 NETWORK_HIGHLIGHT_DURATION_MS 후 자동 만료
    private selectionHighlightedGuid: string | null = null;
    private selectionHighlightPrimitive: Cesium.GroundPrimitive | null = null;
    private selectionHighlightTimer: ReturnType<typeof setTimeout> | null = null;

    /** overview 도로망 폴리라인 색/굵기 */
    private static readonly COLOR_ROAD_OVERVIEW = Cesium.Color.fromBytes(236, 238, 245, 255);

    constructor(private viewer: Viewer) {
        this.dataSource = new Cesium.CustomDataSource(this.LAYER_NAME);
        this.viewer.dataSources.add(this.dataSource);

        highlightNetworkPrimitive = this.highlightInstance.bind(this);
        setNetworkSelectionHighlight = this.selectionHighlightInstance.bind(this);
        clearNetworkSelectionHighlight = this.clearSelectionHighlightInstance.bind(this);

        this.load();
        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {

            this.unsubscribe = store.subscribe(
                (state: { currentJsonData: Network }) => state.currentJsonData,
                () => { this.load(); },
                { equalityFn: (a: Network, b: Network) => a === b }
            );

            // 저장/폐기(isChanged true→false) 감지 → 타일 캐시 무효화 + 즉시 재fetch.
            //   2D NetworkFeatureLayer.onEditsCleared 와 동일한 목적. 이게 없으면 3D 는
            //   id 재채번(hasRemap)이 있었을 때만(utils/networkRefresh) 갱신을 받고,
            //   그 외의 흔한 편집(예: 기존 링크 폭 수정 — 신규 요소도 degree 변화도 없음)은
            //   서버가 저장 시점에 재빌드해둔 타일을 3D 가 카메라를 움직이기 전까지 못 받아온다
            //   (사용자 보고 — 확인됨). refreshNetworkTiles() 는 임포트 후 잔존 네트워크 정리용으로
            //   이미 만들어둔 "타일 전체 무효화 + 즉시 재fetch" 메서드를 그대로 재사용한다.
            this.prevIsChanged = !!(store.getState() as any).isChanged;
            this.unsubscribeChanged = store.subscribe(
                (state: any) => !!state.isChanged,
                (isChanged: boolean) => {
                    if (this.prevIsChanged && !isChanged) this.refreshNetworkTiles();
                    this.prevIsChanged = isChanged;
                },
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

        // tileMode 전환 감지: false→true 전환 시 load() → updateTiles() 트리거
        this.unsubscribeTileMode = useNetworkTileStore.subscribe(
            (state, prev) => { if (state.tileMode && !prev.tileMode) this.load(); }
        );

        // 편집 델타 반영 (타일 모드): 편집/삭제 링크 집합이 바뀌면
        // ① 해당 링크의 원본 청크 재빌드(마스킹 — 옛 형상 제거) ② 새 형상 오버레이 재구성.
        // 이것 없이는 3D 가 서버 타일 원본만 그려 "편집이 2D 에만 반영"됐다.
        this.unsubscribeEdit = useNetworkEditStore.subscribe(
            (s) => [s.editedLinkIds, s.deletedLinkIds] as const,
            ([ed, del], [prevEd, prevDel]) => {
                if (!NETWORK_TILING.ENABLED && !useNetworkTileStore.getState().tileMode) return;
                const changed = new Set<string>();
                for (const id of ed) if (!prevEd.has(id)) changed.add(id);
                for (const id of prevEd) if (!ed.has(id)) changed.add(id);
                for (const id of del) if (!prevDel.has(id)) changed.add(id);
                for (const id of prevDel) if (!del.has(id)) changed.add(id);
                this.rebuildChunksForLinks(changed);
                this.rebuildEditOverlay();
            },
            { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] },
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
        // ⚠️ camera.changed 는 줌/팬 애니메이션 중 렌더 루프 안에서 프레임마다 발화한다.
        // applyVisibility() 는 로드된 모든 청크를 순회하는 O(N) 작업이라(위 scheduleApplyVisibility
        // 주석 참고 — "타일마다 호출하면 O(N²) → 끊김"), 여기서 매 프레임 동기 호출하면 청크가
        // 많이 쌓인 상태(여러 지역을 팬한 광역 시나리오)에서 줌 중 메인 스레드가 순간 막혀
        // "줌인/줌아웃 시 갑자기 멈추는" 현상으로 체감된다(실측 보고) — 같은 파일의 다른 카메라
        // 리스너(차량 집계 등)는 전부 이미 디바운스/setTimeout으로 감싸는데 이 경로만 빠져 있었다.
        // LOD 값(currentLod) 자체는 계산이 가벼우니 즉시 갱신하고, 실제 순회/토글은 이미 있는
        // 80ms 디바운스(scheduleApplyVisibility)로 미룬다.
        const newLod = this.calcLod();
        this.currentLod = newLod;
        this.scheduleApplyVisibility();

        // 타일 모드: 카메라 정착 후(디바운스) viewport 타일 갱신.
        // 400ms — 줌 애니메이션 중간 레벨들의 타일까지 fetch 되어 요청 폭주하던 것 완화
        // (stale abort 가 있어도 발화 자체를 줄이는 편이 낫다)
        if (NETWORK_TILING.ENABLED || useNetworkTileStore.getState().tileMode) {
            if (this.tileCameraTimer) return;
            this.tileCameraTimer = setTimeout(() => {
                this.tileCameraTimer = null;
                this.updateTiles();
            }, 400);
        }
    }

    // ─────────────────────── 타일 모드 (읽기 전용, Cesium) ───────────────────────
    // ⚠️ 편집은 전체-로드 경로 전제. 타일은 합성 guid 기반 뷰 전용.

    /** 화면 중앙 지면점 기준 거리 LOD + 그 주변 bbox → 타일 매니저 갱신.
     *  computeViewRectangle 은 카메라를 기울이면 지평선까지 포함해 폭이 폭발(→ tier 오판/거대 bbox)하므로
     *  사용하지 않는다. 대신 "화면 중앙에서 보는 지점까지 거리"로 판단해 기울임에 강건하게. */
    private updateTiles(): void {
        if (!NETWORK_TILING.ENABLED && !useNetworkTileStore.getState().tileMode) return;
        const scene = this.viewer.scene;
        const camera = this.viewer.camera;
        const canvas = scene.canvas;

        // 화면 중앙 ray → 지면(globe) 교차점. 하늘을 보면(교차 없음) 네트워크 숨김 + 회수.
        const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
        // 지면점: globe.pick(지형) → 실패 시 pickEllipsoid(타원체) 폴백.
        // globe.pick 은 지형 타일 미로딩(줌 직후)·지형서버 장애 시 **지속** 실패할 수 있어
        // 폴백 없이는 타일 fetch 가 영영 시작되지 않는다(실측: 250m 순간이동 후 fetch 0건).
        // 타원체 거리도 pixelSize 용도로는 충분(지형고도 ≪ 카메라 거리 오차 무시 가능).
        const ray = camera.getPickRay(center);
        let ground = ray ? scene.globe.pick(ray, scene) : undefined;
        if (!ground) ground = camera.pickEllipsoid(center, scene.globe.ellipsoid);
        if (!ground) {
            // 그래도 실패(하늘을 보는 시점): 보유 타일 유지, 재시도 예약
            if (!this.pickRetryTimer) {
                this.pickRetryTimer = setTimeout(() => {
                    this.pickRetryTimer = null;
                    try { this.viewer.scene.requestRender(); } catch (_) {}
                    this.updateTiles();
                }, 1000);
            }
            return;
        }
        if (this.pickRetryTimer) { clearTimeout(this.pickRetryTimer); this.pickRetryTimer = null; }

        // 화면 중앙 1px이 덮는 지면 거리(m/px) = 2D OL resolution 과 동일 단위 → tier 기준 일치.
        //   pixelSize = (2·d·tan(fovy/2)) / canvasHeight
        const groundDist = Cesium.Cartesian3.distance(camera.positionWC, ground);
        const frustum: any = camera.frustum;
        const fovy = frustum.fovy ?? frustum.fov ?? Cesium.Math.toRadians(60);
        const canvasH = canvas.clientHeight || 900;
        const canvasW = canvas.clientWidth || 1200;
        const pixelSizeM = (2 * groundDist * Math.tan(fovy / 2)) / canvasH;
        const lod = getNetworkLodTierByResolution(pixelSizeM);
        this.lastPixelTier = lod;

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

        const versionId = getActiveVersionId();
        if (!versionId) return;

        // 버전 전환 감지 — 타일 매니저는 생성 시 versionId 가 고정되므로, 세션 중 활성 버전이
        // 바뀌면(저장 후 새 버전 활성화 등) 이전 버전 데이터로 계속 fetch/표시된다.
        // 이전 버전 청크·캐시를 전부 폐기하고 새 versionId 로 재생성.
        if (this.tileVersionId && this.tileVersionId !== String(versionId)) {
            this.tileManager?.clear();
            this.tileManager = null;
            this.clearRoadOverview();
            this.overviewArterialsActive = false;
            this.overviewFetchedBbox = null;
            this.lastNearTs = 0;
        }
        this.tileVersionId = String(versionId);

        // 줌아웃(macro/overview/mid): viewport 간선 중심선 fetch.
        //   macro    → 고속도로 골격만 (광역/전국 조망, ~26km+ 고도)
        //   overview → rank 0(간선/고속) + 차선수 굵기 강조 → "큰 구조"가 보임
        //   mid      → rank ≤1(집산 포함) → 줌인할수록 조밀
        const tierOrder = NETWORK_LOD_TIER_ORDER[lod as keyof typeof NETWORK_LOD_TIER_ORDER] ?? 99;
        if (tierOrder < NETWORK_LOD_TIER_ORDER.near) {
            // 히스테리시스: 방금 전까지 near/detail 이었다면(경계 플랩·pick 거리 순간 요동)
            // 청크를 지우지 않는다 — detail 사용 중 네트워크가 사라지는 주 원인이었음.
            // 4초 이상 안정적으로 줌아웃 상태일 때만 회수 (메모리는 LRU 상한이 지킴).
            if (performance.now() - this.lastNearTs > 4000) {
                this.tileManager?.clear();    // 타일 청크 evict (안정적 줌아웃)
            }
            const arterialLod = lod === 'mid' ? 'mid'
                : (pixelSizeM > LOD_RES.NETWORK_MACRO ? 'macro' : 'overview');
            this.fetchOverviewArterials(String(versionId), west, south, east, north, arterialLod);
            return;
        }
        this.lastNearTs = performance.now();

        // near 이상: 간선 중심선 베이스레이어를 유지한 채(끊김 방지) 타일 청크를 그 위에 얹는다.
        // 타일은 viewport(+ring)만 커버하므로, 경계 밖 도로가 갑자기 끊겨 보이지 않도록
        // 3배 넓은 bbox의 mid 중심선을 깔아둔다 (bbox-skip 캐시로 팬 시 재요청 거의 없음).
        {
            const cx = (west + east) / 2, cy = (south + north) / 2;
            const hw = (east - west) * 1.5, hh = (north - south) * 1.5;
            this.fetchOverviewArterials(String(versionId), cx - hw, cy - hh, cx + hw, cy + hh, 'mid');
        }
        if (!this.tileManager) {
            this.tileManager = new NetworkTileManager(String(versionId), {
                onTileLoaded: (key, payload, tierOrder) => this.addTileChunk(key, payload, tierOrder),
                onTileEvicted: (key) => this.removeTileChunk(key),
            }, { dropPayloadAfterLoad: true }); // evict 정리는 tileHomeIds로 자체 추적 → payload 캐시 불필요(heap 절감)
        }
        // near: 차선 없는 경량 타일(도로 폴리곤 연속성 우선), detail: 차선+노드/포트/커넥션 엔티티
        this.tileManager.updateForBbox(west, south, east, north, lod);
        this.syncNodeEntities(); // 카메라 정착 시 엔티티 거리 생명주기 갱신 (빌드/제거)
    }

    /** viewport 간선 중심선을 fetch → roadOverviewPrimitive (overview/mid 표시 + near 이상 연속성 베이스).
     *  직전 fetch bbox(30% 패딩)·같은 lod 안의 팬/줌인은 스킵 → 카메라 정착마다 수천 폴리라인 재빌드 방지. */
    private fetchOverviewArterials(versionId: string, w: number, s: number, e: number, n: number, lod: 'macro' | 'overview' | 'mid' = 'overview'): void {
        const prev = this.overviewFetchedBbox;
        if (this.overviewArterialsActive && prev && prev.lod === lod
            && w >= prev.w && e <= prev.e && s >= prev.s && n <= prev.n) {
            return; // 이미 커버된 범위(같은 lod) → 기존 폴리라인 유지
        }

        // 30% 패딩을 더해 fetch → 소폭 팬은 다음에도 스킵됨
        const padX = (e - w) * 0.3, padY = (n - s) * 0.3;
        const pw = w - padX, pe = e + padX, ps = s - padY, pn = n + padY;

        const seq = ++this.overviewFetchSeq;
        // 스피너는 화면에 아무것도 없을 첫 로드만 — 이미 표시 중인 상태의 백그라운드 갱신(팬마다
        // 3x bbox 이탈 시 발생)까지 카운트하면 "네트워크 로딩중"이 계속 떠 있게 된다.
        const countSpinner = !this.overviewArterialsActive;
        if (countSpinner) useNetworkTileStore.getState().incLoading();
        axiosInstance.get(`/network/${versionId}/tiles`, { params: { bbox: `${pw},${ps},${pe},${pn}`, lod } })
            .then((res) => {
                if (seq !== this.overviewFetchSeq || this.destroyed) return; // 더 최신 요청이 있으면 폐기
                const links = (res.data?.links ?? []).filter(Boolean); // null 요소 방어
                this.clearRoadOverview();
                for (const link of links) this.addRoadOverviewPolyline(link);
                this.commitRoadOverview();
                this.overviewArterialsActive = true;
                this.overviewFetchedBbox = { w: pw, s: ps, e: pe, n: pn, lod };
                this.scheduleApplyVisibility();
            })
            .catch((err) => {
                if (err?.response?.status !== 404) console.warn('[NetworkDataSourceLayer] overview 간선 fetch 실패', err);
            })
            .finally(() => {
                if (countSpinner) useNetworkTileStore.getState().decLoading();
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
    private async addTileChunk(tileKey: string, payload: NetworkTilePayload, tierOrder?: number): Promise<void> {
        // 이웃 evict로 인한 강제 재클레임 요청 — 같은 tier로 이미 빌드돼 있어도 재빌드해야
        // 방금 소유권이 풀린 경계 지오메트리를 이번 claim() 에서 새로 가져올 수 있다.
        const forceRebuild = this.pendingForceRebuild.delete(tileKey);
        const existing = this.chunkPrimitives.get(tileKey);
        if (existing) {
            const existingTier = this.chunkTiers.get(tileKey) ?? 99;
            if (!forceRebuild && existingTier >= (tierOrder ?? 99)) return; // 같거나 높은 tier 이미 빌드됨
            // ── tier 승격 (near→detail) 무공백 스왑 ──
            // 기존 청크를 즉시 지우면 새 GroundPrimitive 비동기 빌드 동안 도로가 사라짐.
            // 새 청크를 먼저 빌드하고, 기존 프리미티브는 **새 청크가 ready 된 후** 제거.
            // (고정 지연은 detail 빌드가 그보다 오래 걸리면 공백 발생 — 실사용 재현된 버그)
            this.chunkPrimitives.delete(tileKey);
            const old = existing;
            // (하이라이트는 전용 오버레이 primitive — old 청크 색 원복 불필요)
            const swapStart = performance.now();
            const removeOldWhenReady = () => {
                const fresh = this.chunkPrimitives.get(tileKey);
                const freshPrims = fresh ? [fresh.outline, fresh.link, fresh.lane, fresh.line].filter(Boolean) as any[] : [];
                // 빈 타일(프리미티브 0개)도 ready 취급 — 아니면 old 가 영영 안 지워져 near/detail 겹침
                const allReady = freshPrims.every((p) => { try { return p.ready; } catch { return true; } });
                // 강제 마감 12s: old 가 잔존하면 구(중앙)·신(우측이동) 지오메트리가 겹쳐
                // "보이는 것과 선택되는 것이 다른" 픽 불일치 발생
                const deadline = performance.now() - swapStart > 12000;
                if (allReady || deadline || this.destroyed || !fresh) {
                    if (old.outline) { try { this.viewer.scene.groundPrimitives.remove(old.outline); } catch (_) {} }
                    if (old.link)    { try { this.viewer.scene.groundPrimitives.remove(old.link); } catch (_) {} }
                    if (old.lane)    { try { this.viewer.scene.groundPrimitives.remove(old.lane); } catch (_) {} }
                    if (old.line)    { try { this.viewer.scene.groundPrimitives.remove(old.line); } catch (_) {} }
                    try { this.viewer.scene.requestRender(); } catch (_) {}
                } else {
                    setTimeout(removeOldWhenReady, 500);
                }
            };
            setTimeout(removeOldWhenReady, 500);
        }
        assignTileGuids(payload);

        // ⚠️ 이 타일 링크들의 지형 고도를 terrainHeightMap에 채운다(비동기, 결과 기다리지 않음
        // — 타일 지오메트리 빌드와 무관, 나중에 차량 높이 조회(getNearestTerrainHeight)에서만
        // 쓰임). sampleTerrainForTile/sampleTerrainHeights가 그동안 정의만 되고 어디서도 호출된
        // 적이 없어서 terrainHeightMap이 항상 비어있었다 — 차량이 도로 높이 캐시를 조회해도
        // 매번 null이라 "지형 독립 재조회+스무딩" 폴백만 계속 타서, 도로와 다른 소스로 계산된
        // 높이를 계속 쓰는 원래 문제(뜸/파묻힘)가 그대로 재발했다(실사용자 재확인).
        this.sampleTerrainForTile(payload.links).catch(() => {});

        // cached 맵 병합 (노드/링크 상호참조용)
        for (const node of payload.nodes) this.cachedNodeMap.set(String(node.id), node);
        for (const link of payload.links) {
            const linkId = String(link.id);
            this.cachedLinkMap.set(linkId, link);
            this.retryPendingConnections(linkId);
        }

        // 소유권 결정 — home 타일(첫 좌표 기준)이 빌드하는 게 원칙이지만, home 타일이
        // 로드되지 않은 경계 횡단 링크/노드는 payload에 포함한 이 타일이 대신 빌드(claim).
        // detail은 ring=0이라 home 타일이 viewport 밖이면 영영 안 그려져
        // 도로/차선이 타일 경계에서 잘려 보이던 원인. owner 맵으로 중복 빌드 방지.
        //
        // 그런데 home(또는 먼저 claim한) 타일이 "살아있지만 더 낮은 tier"인 경우가 있다 —
        // 카메라가 넓은 뷰(near/mid)일 때 로드된 타일이 그대로 캐시에 남아있는데, 이후
        // detail로 확대하면서 그 타일이 ring=0 뷰포트 밖으로 밀려나면 다시는 승격 요청을
        // 못 받는다. 그 결과 그 타일이 소유한 링크는 레인이 벗겨진(stripDetail) 채로,
        // 그 타일이 소유한 노드는 detailOrder 미만이라는 이유로(syncNodeEntities 게이트)
        // 영영 안 그려진다 — "교차로 중 한 링크만 레인이 안 보이고, 그 교차로의
        // 노드/포트/커넥션도 안 보인다"는 증상의 실체. claim 실패 시 그 소유 타일을
        // 현재 tier로 강제 승격 재요청한다.
        const staleOwnerTiles = new Set<string>();
        const claim = (id: string, homeKey: string, owner: Map<string, string>): boolean => {
            const cur = owner.get(id);
            if (cur === tileKey) return true;                               // 같은 타일 재빌드(tier 승격)
            if (cur !== undefined && this.tileHomeIds.has(cur)) {
                if (cur !== tileKey && (this.chunkTiers.get(cur) ?? 0) < (tierOrder ?? 0)) {
                    staleOwnerTiles.add(cur);
                }
                return false; // 다른 살아있는 청크가 소유
            }
            if (homeKey === tileKey || !this.tileHomeIds.has(homeKey)) {
                owner.set(id, tileKey);
                return true;
            }
            return false; // home 타일이 로드되어 있으면 그쪽이 빌드
        };
        const ownedNodeIds = payload.nodes
            .filter(nd => claim(String(nd.id), this.nodeChunkKey(nd), this.nodeOwnerTile))
            .map(nd => String(nd.id));
        const ownedLinkIds = payload.links
            .filter(lk => claim(String(lk.id), this.linkChunkKey(lk), this.linkOwnerTile))
            .map(lk => String(lk.id));
        if (staleOwnerTiles.size > 0 && tierOrder !== undefined) {
            const targetLod = NETWORK_LOD_TIER_BY_ORDER[tierOrder] ?? 'detail';
            for (const staleKey of staleOwnerTiles) {
                this.pendingForceRebuild.add(staleKey);
                this.tileManager?.forceRefetch(staleKey, tierOrder, targetLod);
            }
        }

        // evict 정리용 소유 id 기록 (await 이전 — 빌드 중 evict돼도 캐시 정리 가능)
        this.tileHomeIds.set(tileKey, { nodeIds: ownedNodeIds, linkIds: ownedLinkIds });

        // (지형 고도 샘플링 불필요 — GroundPrimitive 클램프가 지형 위 렌더를 보장 → 타일 빌드 즉시 진행)
        if (this.tileManager && !this.tileManager.hasTile(tileKey)) return; // 빌드 중 evict 방지

        // 소유 링크(home + claim)만 청크 인스턴스 빌드
        // (타일별 중심선 폴리라인은 추가하지 않음 — near 이상에서도 mid 베이스레이어가 상시 유지되어 중복)
        // 편집/삭제된 링크는 초기 빌드에서도 제외 (오버레이가 새 형상 담당 — 이중 렌더 방지)
        const editState = useNetworkEditStore.getState();
        const ownedLinkSet = new Set(ownedLinkIds.filter(
            (id) => !editState.editedLinkIds.has(id) && !editState.deletedLinkIds.has(id)));
        const outlineInst: Cesium.GeometryInstance[] = [];
        const linkInst: Cesium.GeometryInstance[] = [];
        const laneInst: Cesium.GeometryInstance[] = [];
        const lineInst: Cesium.GeometryInstance[] = []; // 구분선+중앙선 (GroundPolyline)
        for (const link of payload.links) {
            if (!ownedLinkSet.has(String(link.id))) continue;
            this.buildLinkInstances(link, this.cachedNodeMap, outlineInst, linkInst, laneInst, lineInst, lineInst);
        }
        this.buildChunkPrimitives(tileKey, outlineInst, linkInst, laneInst, lineInst);
        this.chunkTiers.set(tileKey, tierOrder ?? 99);
        // 노드/포트/커넥션 엔티티: 거리 기반 생명주기(syncNodeEntities)가 담당 —
        // 여기서 즉시 빌드하지 않는다. (LRU 64타일 누적 시 엔티티 수천 개가 CPU를 매 프레임
        // 소모해 FPS 한 자리로 추락. DDC는 GPU 컬링만 하고 CPU 비용은 총량에 비례)
        if (tierOrder === undefined) {
            // 비타일 모드: 기존처럼 전부 빌드 (소유 노드 = home + claim)
            const ownedNodeSet = new Set(ownedNodeIds);
            const homeNodes = payload.nodes.filter(nd => ownedNodeSet.has(String(nd.id)));
            if (homeNodes.length > 0) {
                this.nodeBuildQueue.set(tileKey, homeNodes);
                this.scheduleNodeBuild();
            }
        } else {
            this.syncNodeEntities();
        }

        // applyVisibility 는 전체 청크 순회(거리 컬링)라 타일마다 호출하면 O(N²) → 끊김.
        // 여러 타일이 동시에 로드될 때 debounce 로 1회만 실행.
        this.scheduleApplyVisibility();
    }

    /**
     * 노드/포트/커넥션 엔티티 거리 기반 생명주기 — 카메라 1km 진입 시 빌드, 1.3km 이탈 시 제거.
     * 엔티티 총량을 viewport 주변 수백 개로 제한 (총량이 CPU 프레임 비용을 결정).
     * 노드 데이터는 cachedNodeMap 에 남아 있어 재진입 시 재빌드 가능.
     *
     * 판정은 **노드 단위** 거리. 타일 단위(중심/영역 근사)는 둘 다 실패했던 이력:
     * 중심 기준 → 타일 가장자리 노드가 영영 안 빌드(반대각 ~1.8km > BUILD_R),
     * 영역 근사(중심−반대각) → 대각 이웃까지 과통과 → 밀집 지역 엔티티 1만+ 적체로 FPS 붕괴.
     */
    private syncNodeEntities(): void {
        const detailOrder = NETWORK_LOD_TIER_ORDER.detail;
        const cam = this.viewer.scene.camera.positionWC;
        const BUILD_R = 1000, DROP_R = 1300; // 히스테리시스
        const toDrop: string[] = [];
        for (const [key, home] of this.tileHomeIds) {
            if ((this.chunkTiers.get(key) ?? 0) < detailOrder) continue;
            let buildList: any[] | null = null;
            for (const nodeId of home.nodeIds) {
                const node = this.cachedNodeMap.get(nodeId);
                const c = node?.coordinates;
                if (!c || c.lng == null || c.lat == null) continue;
                // 노드 위치 Cartesian 캐시 (settle마다 fromDegrees 재계산 방지)
                let pos: Cesium.Cartesian3 = node.__pos3d;
                if (!pos) { pos = Cesium.Cartesian3.fromDegrees(c.lng, c.lat); node.__pos3d = pos; }
                const d = Cesium.Cartesian3.distance(cam, pos);
                const has = this.nodeEntityIds.has(nodeId);
                if (!has && d <= BUILD_R) {
                    (buildList ??= []).push(node);
                } else if (has && d > DROP_R) {
                    toDrop.push(nodeId);
                }
            }
            if (buildList && buildList.length > 0) {
                this.nodeBuildQueue.set(key, buildList);
                this.scheduleNodeBuild();
            }
        }
        if (toDrop.length > 0) {
            this.dataSource.entities.suspendEvents();
            try {
                for (const nodeId of toDrop) {
                    const ids = this.nodeEntityIds.get(nodeId);
                    if (ids) {
                        for (const id of ids) {
                            const ent = this.dataSource.entities.getById(id);
                            if (ent) this.dataSource.entities.remove(ent);
                        }
                        this.nodeEntityIds.delete(nodeId);
                    }
                }
            } finally {
                this.dataSource.entities.resumeEvents();
            }
        }
    }

    /** applyVisibility() 조건 미충족 시 노드/포트/커넥션 엔티티를 전부 제거 (dataSource.show 토글 대신 —
     *  이유는 applyVisibility() 호출부 주석 참고). 빌드 대기 큐도 함께 비운다. */
    private hideAllNodeEntities(): void {
        this.nodeBuildQueue.clear();
        if (this.nodeEntityIds.size === 0) return;
        this.dataSource.entities.suspendEvents();
        try {
            for (const ids of this.nodeEntityIds.values()) {
                for (const id of ids) {
                    const ent = this.dataSource.entities.getById(id);
                    if (ent) this.dataSource.entities.remove(ent);
                }
            }
            this.nodeEntityIds.clear();
        } finally {
            this.dataSource.entities.resumeEvents();
        }
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

    /** 타일 청크 evict → 프리미티브/폴리라인/노드 엔티티 제거 (tileHomeIds 기반, payload 비의존) */
    private removeTileChunk(tileKey: string): void {
        this.nodeBuildQueue.delete(tileKey); // 빌드 대기 중이던 노드 취소
        const chunk = this.chunkPrimitives.get(tileKey);
        if (chunk) {
            if (chunk.outline) this.viewer.scene.groundPrimitives.remove(chunk.outline);
            if (chunk.link)    this.viewer.scene.groundPrimitives.remove(chunk.link);
            if (chunk.lane)    this.viewer.scene.groundPrimitives.remove(chunk.lane);
            if (chunk.line)    this.viewer.scene.groundPrimitives.remove(chunk.line);
            this.chunkPrimitives.delete(tileKey);
            this.chunkCenters.delete(tileKey);
            this.chunkTiers.delete(tileKey);
        }
        // (타일별 중심선 없음 — mid 베이스레이어가 전담)
        // home 노드/링크 정리 — addTileChunk에서 기록한 id 목록 사용
        // (manager가 heap 절감을 위해 payload를 드롭하므로 payload 역추적 불가)
        const home = this.tileHomeIds.get(tileKey);
        for (const nodeId of home?.nodeIds ?? []) {
            const ids = this.nodeEntityIds.get(nodeId);
            if (ids) {
                for (const id of ids) {
                    const ent = this.dataSource.entities.getById(id);
                    if (ent) this.dataSource.entities.remove(ent);
                }
                this.nodeEntityIds.delete(nodeId);
            }
            this.cachedNodeMap.delete(nodeId);
            this.nodeOwnerTile.delete(nodeId);
        }
        for (const linkId of home?.linkIds ?? []) {
            // 픽 속성 맵도 함께 정리 — 남겨두면 evict 된(화면에 없는) 링크가
            // 지면점 기하 탐색(pickNetworkAtPosition)에 걸려 "안 보이는 것이 선택"된다
            const link = this.cachedLinkMap.get(linkId);
            if (link?.__guid) {
                networkPrimitivePropertiesMap.delete(link.__guid);
                for (const lane of link.lanes ?? []) {
                    if (lane?.__guid) networkPrimitivePropertiesMap.delete(lane.__guid);
                }
            }
            this.cachedLinkMap.delete(linkId);
            this.linkOwnerTile.delete(linkId);
        }
        const hadOwnership = (home?.nodeIds?.length ?? 0) > 0 || (home?.linkIds?.length ?? 0) > 0;
        this.tileHomeIds.delete(tileKey);
        try { this.viewer.scene.requestRender(); } catch (_) {}

        // 이 타일이 소유(claim)하고 있던 경계 횡단 링크/노드는 방금 소유권이 풀렸다.
        // home 타일이 아니라서 애초에 claim 하지 못했던 살아있는 이웃 타일에게 재클레임
        // 기회를 주지 않으면, 그 이웃은 이미 로드된 상태라 다시 요청할 트리거가 없어
        // 이 링크/노드(와 거기 달린 레인/커넥션)가 세션 내내 고아로 남아 영구히 안 그려진다.
        if (hadOwnership) {
            for (const neighborKey of this.neighborTileKeys(tileKey)) {
                if (this.tileHomeIds.has(neighborKey)) {
                    this.pendingForceRebuild.add(neighborKey);
                    this.tileManager?.forceRefetch(neighborKey);
                }
            }
        }
    }

    /** "tx,ty" 타일 키의 8방향 인접 타일 키 (경계 횡단 지오메트리 재클레임용) */
    private neighborTileKeys(tileKey: string): string[] {
        const [txStr, tyStr] = tileKey.split(',');
        const tx = Number(txStr), ty = Number(tyStr);
        const keys: string[] = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                keys.push(`${tx + dx},${ty + dy}`);
            }
        }
        return keys;
    }

    /** linkId 가 캐시에 새로 들어왔을 때, 그 링크를 기다리던 커넥션들을 재시도한다. */
    private retryPendingConnections(linkId: string): void {
        const pending = this.pendingConnectionsByLink.get(linkId);
        if (!pending || pending.length === 0) return;
        this.pendingConnectionsByLink.delete(linkId);
        let added = false;
        for (const { conn, node } of pending) {
            const ids = this.nodeEntityIds.get(String(node.id));
            if (!ids) continue; // 노드가 이미 drop(카메라 이탈/evict)됨 — 되살리지 않음
            if (this.addConnectionEntity(conn, node) && conn.__guid && !ids.includes(conn.__guid)) {
                ids.push(conn.__guid);
                added = true;
            }
        }
        if (added) { try { this.viewer.scene.requestRender(); } catch (_) {} }
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
            if (chunk.line)    chunk.line.show    = layer && laneFT && lod === 'full' && inLaneRange;
        }

        // overview 도로망 중심선: 비타일 모드는 outline LOD(원거리), 타일 모드는 줌아웃 간선 fetch 활성 시.
        // detail(완전 근접)에선 숨김 — 도로 폴리곤 위로 주변 골목 중심선 그물이 겹쳐 노이즈
        // (near 는 타일 경계 밖 연속성용으로 유지).
        this.roadOverviewShow = layer && linkFT
            && (lod === 'outline' || this.overviewArterialsActive)
            && this.lastPixelTier !== 'detail';
        if (this.roadOverviewPrimitive) this.roadOverviewPrimitive.show = this.roadOverviewShow;

        // 노드/포트/커넥션 엔티티: alt 기반 full + **pixelSize 기반 detail** 둘 다 만족할 때만.
        // alt 기준만 쓰면 near(0.3~1.5m/px)에서도 detail 시절 쌓인 엔티티 수천 개가 전역 표시되어
        // FPS 급락 + "먼 엔티티까지 보임" (비타일 모드는 lastPixelTier='unknown' → 기존 동작).
        //
        // 예전엔 이 조건을 dataSource.show 로 한 번에 켜고 껐다 — 그런데 dataSource.show 토글은
        // Cesium 내부적으로 그 안의 "모든" 엔티티의 isShowing 변경 이벤트를 한꺼번에 발생시키고,
        // StaticGroundPolylinePerMaterialBatch(신호/커넥션 GroundPolyline 배치)는 그 이벤트를
        // 내부 showsUpdated 큐에 넣어뒀다가 다음 렌더에서 처리한다. syncNodeEntities()가 카메라
        // 정착마다 같은 타이밍에 노드 엔티티를 실제로 remove() 하는데, 그 엔티티가 방금 이 토글로
        // showsUpdated에 큐잉된 상태에서 remove되면 큐의 참조가 남아 다음 프레임에서
        // "Cannot read properties of undefined (reading 'id')"로 영구 크래시한다(Cesium 자체 버그,
        // remove()가 showsUpdated를 청소하지 않음 — 실측: 줌/팬 반복 시 재현, 콘솔 스택
        // Batch6.updateShows). dataSource.show를 아예 건드리지 않고, 조건 미충족 시 이 레이어가
        // 이미 갖고 있는 "엔티티 제거" 경로(hideAllNodeEntities, syncNodeEntities와 동일 메커니즘)만
        // 쓰면 토글-직후-제거 레이스 자체가 발생하지 않는다.
        const entityTierOk = this.lastPixelTier === 'unknown' || this.lastPixelTier === 'detail';
        const shouldShowEntities = layer && lod === 'full' && entityTierOk;
        if (!shouldShowEntities) {
            if (!this.entitiesHiddenByVisibility) {
                this.hideAllNodeEntities();
                this.entitiesHiddenByVisibility = true;
            }
        } else if (this.entitiesHiddenByVisibility) {
            this.entitiesHiddenByVisibility = false;
            this.syncNodeEntities(); // 조건 충족 시 거리 기반으로 근접 노드 재빌드
        }
        // GroundPolylinePrimitive(지형 클램프) 전환으로 depth test 를 항상 켜도 중심선이 안 묻힘
        // → 땅속 오브젝트가 투과되어 보이던 문제 제거
        this.viewer.scene.globe.depthTestAgainstTerrain = true;
    }

    // ─────────────────────────────────────────────
    // Primitive 하이라이트 (이벤트 핸들러에서 호출)
    // ─────────────────────────────────────────────
    /** 링크 하이라이트 — 전용 오버레이 GroundPrimitive.
     *  기존 방식(청크 배치 인스턴스의 색 속성 변조)은 tier 스왑으로 같은 링크의 구/신
     *  청크가 기하적으로 겹쳐 렌더되는 동안 노란색이 어느 사본에 칠해졌는지·어느 사본이
     *  위에 그려지는지가 카메라 이동(청크 재빌드/스왑)마다 바뀌어 **노란 영역이 도로 안에서
     *  움직이는** 문제를 만들었다. 링크 좌표에서 렌더와 동일한 corridor 를 즉석 생성해
     *  최상위에 얹으면 청크 생명주기와 완전히 분리된다 (색 복원 부기도 불필요). */
    /** 링크/레인 하이라이트 corridor primitive 빌드 (추가는 호출측). 빌드 불가 시 null. */
    private buildHighlightPrimitive(cacheKey: string, guid: string, laneIdx?: number): Cesium.GroundPrimitive | null {
        const props = networkPrimitivePropertiesMap.get(guid);
        const coords = props?.featureType === 'links'
            ? (props.coordinates ?? []).filter((c: any) => c && isFinite(c.lng) && isFinite(c.lat))
            : [];
        if (coords.length < 2) return null;
        const roadWidth = props.width ?? 7;
        const laneCount = props.lanes?.length || props.numLane || 1;
        // 레인 지정 시: 그 레인만(폭=laneWidth, 중심 오프셋). 아니면 링크 전체(폭=roadWidth, 우측 반폭).
        //   렌더 규약(중앙정렬, (i - (laneCount-1)/2)*laneWidth, 차선0=최좌측)과 정합.
        const isLane = laneIdx != null && laneIdx >= 0 && laneIdx < laneCount;
        const laneWidth = roadWidth / laneCount;
        const width = isLane ? laneWidth : roadWidth;
        const offset = isLane
            ? (laneIdx! - (laneCount - 1) / 2) * laneWidth
            : 0;
        const shifted = this.computeOffsetPositions(coords, offset);
        return new Cesium.GroundPrimitive({
            geometryInstances: new Cesium.GeometryInstance({
                id: `${cacheKey}_highlight`,
                geometry: new Cesium.CorridorGeometry({
                    positions: shifted,
                    width,
                    cornerType: Cesium.CornerType.MITERED,
                    vertexFormat: Cesium.PerInstanceColorAppearance.VERTEX_FORMAT,
                }),
                attributes: {
                    // 알파 1.0 — 불투명(translucent:false) 패스와 정합 (반투명은 분류 렌더 오동작 유발)
                    color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.YELLOW),
                },
            }),
            appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: false }),
            asynchronous: false, // 단일 corridor — 동기 빌드로 hover 즉시 표시 (ready 펌프 불필요)
            classificationType: Cesium.ClassificationType.BOTH,
        });
    }

    /** hover 하이라이트 (hover 슬롯 전용) — 선택 슬롯은 절대 건드리지 않는다. */
    private highlightInstance(guid: string | null, laneIdx?: number): void {
        const cacheKey = guid == null ? null : (laneIdx != null ? `${guid}#${laneIdx}` : guid);

        // 선택 슬롯과 동일 대상이면 hover 오버레이 불필요 — 선택 강조가 이미 표시 중
        if (cacheKey != null && cacheKey === this.selectionHighlightedGuid) {
            if (this.highlightPrimitive) {
                try { this.viewer.scene.groundPrimitives.remove(this.highlightPrimitive); } catch (_) {}
                this.highlightPrimitive = null;
                this.highlightedGuid = null;
                try { this.viewer.scene.requestRender(); } catch (_) {}
            }
            return;
        }

        if (this.highlightedGuid === cacheKey) return; // hover 마다 재호출 — 동일 대상이면 no-op
        this.highlightedGuid = cacheKey;

        if (this.highlightPrimitive) {
            try { this.viewer.scene.groundPrimitives.remove(this.highlightPrimitive); } catch (_) {}
            this.highlightPrimitive = null;
        }

        if (guid && cacheKey) {
            this.highlightPrimitive = this.buildHighlightPrimitive(cacheKey, guid, laneIdx);
            if (this.highlightPrimitive) this.viewer.scene.groundPrimitives.add(this.highlightPrimitive);
        }
        this.pumpHighlightRender(this.highlightPrimitive);
    }

    /**
     * 하이라이트 corridor 즉시 표시용 렌더 펌프.
     * requestRenderMode 에서 GroundPrimitive 는 (asynchronous:false 여도) 첫 update 프레임에
     * 리소스 준비만 되고 실제 드로우는 이후 프레임이라, 렌더를 1회만 요청하면 같은 객체 위에
     * 머무는 동안 추가 프레임이 없어 **다음 호버 대상이 바뀔 때에야 이전 하이라이트가
     * 나타나는** off-by-one 이 된다. ready 될 때까지 + 드로우 여유 2프레임을 연속 요청한다
     * (상한 10프레임 — 호버 1회당 수 프레임 수준의 미미한 비용).
     */
    private pumpHighlightRender(prim: Cesium.GroundPrimitive | null): void {
        try { this.viewer.scene.requestRender(); } catch (_) {}
        if (!prim) return; // 제거만 한 경우 — 1프레임이면 충분
        let extra = 2, frames = 0;
        const step = () => {
            if (this.destroyed) return;
            try { if ((prim as any).isDestroyed?.()) return; } catch (_) { return; }
            try { this.viewer.scene.requestRender(); } catch (_) {}
            if (++frames >= 10) return;
            if (prim.ready && --extra < 0) return;
            requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }

    /** 선택 하이라이트 (그리드/클릭) — hover 가 덮지 못하며 일정 시간 후 자동 만료. */
    private selectionHighlightInstance(guid: string, laneIdx?: number): void {
        const cacheKey = laneIdx != null ? `${guid}#${laneIdx}` : guid;
        if (this.selectionHighlightTimer) { clearTimeout(this.selectionHighlightTimer); this.selectionHighlightTimer = null; }

        if (this.selectionHighlightedGuid !== cacheKey) {
            if (this.selectionHighlightPrimitive) {
                try { this.viewer.scene.groundPrimitives.remove(this.selectionHighlightPrimitive); } catch (_) {}
                this.selectionHighlightPrimitive = null;
            }
            this.selectionHighlightedGuid = cacheKey;
            this.selectionHighlightPrimitive = this.buildHighlightPrimitive(`${cacheKey}_sel`, guid, laneIdx);
            if (this.selectionHighlightPrimitive) this.viewer.scene.groundPrimitives.add(this.selectionHighlightPrimitive);
            // hover 슬롯이 같은 대상을 잡고 있으면 정리 (중복 오버레이 방지)
            if (this.highlightedGuid === cacheKey && this.highlightPrimitive) {
                try { this.viewer.scene.groundPrimitives.remove(this.highlightPrimitive); } catch (_) {}
                this.highlightPrimitive = null;
                this.highlightedGuid = null;
            }
        }
        // 재선택마다 수명 연장 — 2D(showNetworkHighlight2D)와 동일 생명주기
        this.selectionHighlightTimer = setTimeout(() => {
            this.selectionHighlightTimer = null;
            this.clearSelectionHighlightInstance();
        }, NETWORK_HIGHLIGHT_DURATION_MS);
        this.pumpHighlightRender(this.selectionHighlightPrimitive);
    }

    /** 선택 하이라이트 해제 (선택 슬롯 전용). */
    private clearSelectionHighlightInstance(): void {
        if (this.selectionHighlightTimer) { clearTimeout(this.selectionHighlightTimer); this.selectionHighlightTimer = null; }
        if (this.selectionHighlightPrimitive) {
            try { this.viewer.scene.groundPrimitives.remove(this.selectionHighlightPrimitive); } catch (_) {}
            this.selectionHighlightPrimitive = null;
        }
        this.selectionHighlightedGuid = null;
        try { this.viewer.scene.requestRender(); } catch (_) {}
    }

    /**
     * 네트워크 교체(임포트) 후 호출 — 3D 타일/간선 캐시 무효화 + 현재 카메라 기준 재fetch.
     * 타일 매니저 LRU 는 타일 키가 같으면 "이미 로드됨"으로 재fetch 를 건너뛰고,
     * 간선 중심선도 bbox-skip 캐시(overviewFetchedBbox)로 유지되므로, 여기서 비우지
     * 않으면 임포트 후에도 3D 에 이전 네트워크가 계속 남는다 (2D 는 OL 쪽 refreshNetworkTiles 가 처리).
     */
    public refreshNetworkTiles(): void {
        // clear() 가 타일마다 onTileEvicted→removeTileChunk 를 호출해
        // 청크 primitive/노드 엔티티/cached 맵/픽 속성 맵까지 함께 정리된다.
        this.tileManager?.clear();
        this.clearRoadOverview();
        this.overviewArterialsActive = false;
        this.overviewFetchedBbox = null;
        this.lastNearTs = 0; // 줌아웃 히스테리시스 무시 — 즉시 재fetch 허용
        this.updateTiles();
        try { this.viewer.scene.requestRender(); } catch (_) {}
    }

    // ─────────────────────────────────────────────
    // 진입점
    // ─────────────────────────────────────────────
    public load(): void {
        // 타일 모드: store 기반 전체 빌드를 하지 않는다 (타일 매니저가 viewport 청크만 빌드).
        if (NETWORK_TILING.ENABLED || useNetworkTileStore.getState().tileMode) {
            // ⚠️ load() 는 store.currentJsonData 구독으로 자주 재진입한다
            // (OL NetworkFeatureLayer 의 viewport→store 동기화가 타일 로드마다 발화).
            // 여기서 무조건 청크를 지우면: tileManager 캐시는 "이미 로드됨"이라 재빌드가
            // 안 일어나 **네트워크가 통째로 사라진 채 복구 불가** (실사용 재현된 핵심 버그).
            // → full 빌드 잔재가 있을 때(모드 전환)만 정리하고, 평상시엔 updateTiles만.
            if (this.hasFullBuildArtifacts) {
                this.hasFullBuildArtifacts = false;
                this.removeAllChunkPrimitives();
                this.clearRoadOverview();
                this.tileManager?.clear(); // 청크·매니저 캐시를 함께 비워 상태 일치
                this.viewer.dataSources.remove(this.dataSource, true);
                this.dataSource = new Cesium.CustomDataSource(this.LAYER_NAME);
                this.viewer.dataSources.add(this.dataSource);
                this.prevNetwork = null;
            }
            this.updateTiles();
            // 편집 중 형상 변경(드래그/undo)은 editedLinkIds 집합이 안 변해도 좌표가 변한다
            // → store 데이터 변경마다 오버레이 재구성 (집합 변경은 edit 구독이 청크 마스킹까지 처리)
            this.rebuildEditOverlay();
            return;
        }
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
        const hasCommon = next.links.some(l => l && this.cachedLinkMap.has(String(l.id)));
        return !hasCommon;
    }

    // ─────────────────────────────────────────────
    // 전체 재빌드
    // ─────────────────────────────────────────────
    private async fullBuild(network: Network): Promise<void> {
        const generation = ++this.fullBuildGeneration;
        this.hasFullBuildArtifacts = true; // 타일 모드 전환 시 이 산출물을 정리해야 함

        // tile 모드 잔여 청크/폴리라인 정리 (tile → full 전환)
        this.tileManager?.clear();
        this.tileManager = null;
        this.overviewArterialsActive = false;
        this.overviewFetchedBbox = null;

        // 이전 네트워크를 즉시 제거 (지형 샘플링 전에 화면 클리어)
        this.removeAllChunkPrimitives();
        this.viewer.dataSources.remove(this.dataSource, true);
        this.dataSource = new Cesium.CustomDataSource(this.LAYER_NAME);
        this.viewer.dataSources.add(this.dataSource);

        // (지형 고도 샘플링 불필요 — GroundPrimitive 클램프)
        if (this.destroyed || generation !== this.fullBuildGeneration) return;

        this.nodeEntityIds.clear();
        this.lanePositionMap.clear();
        networkPrimitivePropertiesMap.clear();

        // null 요소 방어: 배열에 구멍/널이 섞여도 빌드가 TypeError 로 죽지 않도록 걸러서 순회
        const validNodes = network.nodes.filter(Boolean);
        const validLinks = network.links.filter(Boolean);
        this.cachedNodeMap = new Map(validNodes.map(n => [String(n.id), n]));
        this.cachedLinkMap = new Map(validLinks.map(l => [String(l.id), l]));

        // 링크·레인 → 공간 청크별 Primitive
        const chunkOutline = new Map<string, Cesium.GeometryInstance[]>();
        const chunkLink    = new Map<string, Cesium.GeometryInstance[]>();
        const chunkLane    = new Map<string, Cesium.GeometryInstance[]>(); // lane 면
        const chunkLine    = new Map<string, Cesium.GeometryInstance[]>(); // 구분선+중앙선 (폴리라인)

        this.clearRoadOverview();
        for (const link of validLinks) {
            const key = this.linkChunkKey(link);
            if (!chunkOutline.has(key)) {
                chunkOutline.set(key, []); chunkLink.set(key, []); chunkLane.set(key, []); chunkLine.set(key, []);
            }
            const lineArr = chunkLine.get(key)!;
            this.buildLinkInstances(link, this.cachedNodeMap,
                chunkOutline.get(key)!, chunkLink.get(key)!, chunkLane.get(key)!, lineArr, lineArr);
            this.addRoadOverviewPolyline(link);
        }
        this.commitRoadOverview();
        for (const key of chunkOutline.keys()) {
            this.buildChunkPrimitives(key, chunkOutline.get(key)!, chunkLink.get(key)!, chunkLane.get(key)!, chunkLine.get(key)!);
        }

        // 노드·포트·커넥션 → DataSource Entity
        // suspendEvents()+removeAll()은 렌더 틱과 race를 일으켜
        // StaticGroundPolylinePerMaterialBatch 내부 _items에 undefined 슬롯을 만든다.
        // viewer에서 완전히 제거 후 새 DataSource로 교체하면 배치 오염이 없다.
        this.viewer.dataSources.remove(this.dataSource, true);
        this.dataSource = new Cesium.CustomDataSource(this.LAYER_NAME);
        for (const node of validNodes) {
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

    /** overview 도로망 중심선 1개를 버퍼에 추가 (링크 중심선, 픽셀 굵기 + 차선수 비례).
     *  루프 후 commitRoadOverview() 로 1개 GroundPolylinePrimitive 로 커밋해야 화면에 반영된다. */
    private addRoadOverviewPolyline(link: any): void {
        const coords = link.coordinates;
        if (!coords || coords.length < 2) return;
        const positions = coords
            .filter((c: any) => c && isFinite(c.lng) && isFinite(c.lat))
            .map((c: any) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat));
        if (positions.length < 2) return;
        // 타일 응답은 lanes 가 strip 되므로 numLane 속성 사용 (간선 강조의 핵심)
        const laneCount = link.lanes?.length || link.numLane || 1;
        // 간선(차선 多)일수록 굵게: 1차선 1px ~ 8차선 4.5px → 줌아웃에서 고속/간선 구조가 도드라짐
        const width = Math.max(1, Math.min(4.5, 0.6 + laneCount * 0.5));
        this.roadOverviewBuffer.push(new Cesium.GeometryInstance({
            geometry: new Cesium.GroundPolylineGeometry({ positions, width }),
        }));
    }

    /** 버퍼의 중심선 인스턴스들을 지형 클램프 primitive 1개로 커밋 (기존 것 교체) */
    private commitRoadOverview(): void {
        if (this.roadOverviewPrimitive) {
            try { this.viewer.scene.groundPrimitives.remove(this.roadOverviewPrimitive); } catch (_) {}
            this.roadOverviewPrimitive = null;
        }
        if (this.roadOverviewBuffer.length === 0) return;
        this.roadOverviewPrimitive = new Cesium.GroundPolylinePrimitive({
            geometryInstances: this.roadOverviewBuffer,
            appearance: new Cesium.PolylineMaterialAppearance({
                material: Cesium.Material.fromType("Color", {
                    color: NetworkDataSourceLayer.COLOR_ROAD_OVERVIEW,
                }),
            }),
            asynchronous: true,
            show: this.roadOverviewShow,
            classificationType: Cesium.ClassificationType.BOTH, // 3D Tiles 위에도 드레이프
        });
        this.viewer.scene.groundPrimitives.add(this.roadOverviewPrimitive);
        this.pumpUntilReady([this.roadOverviewPrimitive]); // requestRenderMode에서 ready까지 렌더 펌핑
        this.roadOverviewBuffer = [];
    }

    /** 중심선 전부 제거 (버퍼 + primitive) */
    private clearRoadOverview(): void {
        this.roadOverviewBuffer = [];
        if (this.roadOverviewPrimitive) {
            try { this.viewer.scene.groundPrimitives.remove(this.roadOverviewPrimitive); } catch (_) {}
            this.roadOverviewPrimitive = null;
        }
    }

    /** 링크 중심 좌표를 기반으로 청크 키 계산 */
    private linkChunkKey(link: any): string {
        const c = link.coordinates?.[0];
        if (!c) return '0,0';
        const cx = Math.floor(c.lng / NetworkDataSourceLayer.CHUNK_DEG);
        const cy = Math.floor(c.lat / NetworkDataSourceLayer.CHUNK_DEG);
        return `${cx},${cy}`;
    }

    /**
     * requestRenderMode 에서 비동기 GroundPrimitive 는 렌더 프레임이 돌아야 update()가 진행되어
     * ready 가 된다. 카메라가 멈춘 뒤 도착한 타일은 프레임이 없어 **영영 화면에 안 나타남**.
     * 전역 펌프 하나가 pending 집합의 모든 prim 이 ready 될 때까지 렌더를 요청한다.
     * ⚠️ 시간 상한 없음 — detail 청크(차선/구분선 수천 인스턴스)는 12s+ 걸릴 수 있어,
     * 상한을 두면 준비가 늦은 청크가 영영 invisible (줌인 시 사라짐의 원인이었음).
     */
    private pumpPending = new Set<any>();
    private pumpTimer: ReturnType<typeof setInterval> | null = null;

    private pumpUntilReady(prims: (Cesium.GroundPrimitive | Cesium.GroundPolylinePrimitive | null)[]): void {
        for (const p of prims) if (p) this.pumpPending.add(p);
        if (this.pumpPending.size === 0 || this.pumpTimer) return;
        this.pumpTimer = setInterval(() => {
            for (const p of [...this.pumpPending]) {
                try {
                    if ((p as any).isDestroyed?.() || p.ready) this.pumpPending.delete(p);
                } catch (_) { this.pumpPending.delete(p); }
            }
            try { this.viewer.scene.requestRender(); } catch (_) {}
            if (this.pumpPending.size === 0 || this.destroyed) {
                if (this.pumpTimer) { clearInterval(this.pumpTimer); this.pumpTimer = null; }
            }
        }, 200);
    }

    /** 청크 하나의 Primitives 생성·등록.
     *  GroundPrimitive(지형 클램프) — 절대고도 Primitive는 지형 고도와 어긋나면
     *  묻히거나(depth test on) 땅속 투과로 보임(off). 클램프로 두 문제를 모두 제거.
     *  groundPrimitives 추가 순서 = 그리기 순서 → outline < link < lane 레이어링 유지. */
    private buildChunkPrimitives(
        key: string,
        outlineInst: Cesium.GeometryInstance[],
        linkInst:    Cesium.GeometryInstance[],
        laneInst:    Cesium.GeometryInstance[],
        lineInst:    Cesium.GeometryInstance[] = [],
    ): void {
        // (하이라이트는 전용 오버레이 primitive — 청크 재빌드와 무관, 리셋 불필요)

        // translucent:false — 불투명 분류가 blend 순서 의존성이 없어 시점 안정적.
        // (색상 알파는 전부 200+ 로 사실상 불투명 — translucent 경로는 비용만 들고 아티팩트 유발)
        const appearance = () => new Cesium.PerInstanceColorAppearance({ flat: true, translucent: false });
        // ⚠️ 분류 대상은 **모든 도로 요소가 동일**해야 한다 (전부 BOTH).
        // 요소별로 TERRAIN/BOTH 를 섞으면 지형과 3D Tiles 표면 높이가 다른 곳에서
        // 레인과 도로가 서로 다른 표면에 그려져, 카메라 이동 시 시차로 어긋나 도는 아티팩트 발생.
        const makeGround = (instances: Cesium.GeometryInstance[]) =>
            new Cesium.GroundPrimitive({
                geometryInstances: instances,
                appearance: appearance(),
                asynchronous: true,
                classificationType: Cesium.ClassificationType.BOTH,
            });
        const chunk: ChunkPrimitives = { outline: null, link: null, lane: null, line: null };

        if (outlineInst.length > 0) {
            chunk.outline = makeGround(outlineInst);
            this.viewer.scene.groundPrimitives.add(chunk.outline);
        }
        if (linkInst.length > 0) {
            chunk.link = makeGround(linkInst);
            this.viewer.scene.groundPrimitives.add(chunk.link);
        }
        if (laneInst.length > 0) {
            chunk.lane = makeGround(laneInst);
            this.viewer.scene.groundPrimitives.add(chunk.lane);
        }
        if (lineInst.length > 0) {
            // 구분선/중앙선: 픽셀 폭 GroundPolyline — 초박형 corridor 분류볼륨의 시선각 아티팩트 회피
            chunk.line = new Cesium.GroundPolylinePrimitive({
                geometryInstances: lineInst,
                appearance: new Cesium.PolylineColorAppearance(),
                asynchronous: true,
                classificationType: Cesium.ClassificationType.BOTH,
            });
            this.viewer.scene.groundPrimitives.add(chunk.line);
        }

        this.chunkPrimitives.set(key, chunk);
        this.pumpUntilReady([chunk.outline, chunk.link, chunk.lane, chunk.line]); // 카메라 정지 상태에서도 ready까지 렌더 펌핑

        // 청크 중심 좌표 계산
        const [cx = 0, cy = 0] = key.split(',').map(Number);
        const centerLng = (cx + 0.5) * NetworkDataSourceLayer.CHUNK_DEG;
        const centerLat = (cy + 0.5) * NetworkDataSourceLayer.CHUNK_DEG;
        this.chunkCenters.set(key, Cesium.Cartesian3.fromDegrees(centerLng, centerLat));
    }

    /** 편집/삭제 링크가 속한(빌드한) 청크만 캐시 데이터로 재빌드 — 원본 형상 마스킹.
     *  청크는 배치 GroundPrimitive 라 개별 인스턴스를 숨길 수 없어, 소유 링크 목록에서
     *  편집/삭제 id 를 제외하고 다시 빌드한다 (2D MVT styleFunction 숨김의 3D 대응). */
    private rebuildChunksForLinks(linkIds: Set<string>): void {
        if (linkIds.size === 0) return;
        const keys = new Set<string>();
        for (const id of linkIds) {
            const k = this.linkOwnerTile.get(id);
            if (k) keys.add(k);
        }
        for (const key of keys) this.rebuildChunkFromCache(key);
        if (keys.size > 0) this.scheduleApplyVisibility();
    }

    private rebuildChunkFromCache(key: string): void {
        const chunk = this.chunkPrimitives.get(key);
        const home = this.tileHomeIds.get(key);
        if (!chunk || !home) return;
        if (chunk.outline) { try { this.viewer.scene.groundPrimitives.remove(chunk.outline); } catch (_) { /* noop */ } }
        if (chunk.link)    { try { this.viewer.scene.groundPrimitives.remove(chunk.link); } catch (_) { /* noop */ } }
        if (chunk.lane)    { try { this.viewer.scene.groundPrimitives.remove(chunk.lane); } catch (_) { /* noop */ } }
        if (chunk.line)    { try { this.viewer.scene.groundPrimitives.remove(chunk.line); } catch (_) { /* noop */ } }
        this.chunkPrimitives.delete(key);

        const edit = useNetworkEditStore.getState();
        const tier = this.chunkTiers.get(key);
        const outlineInst: Cesium.GeometryInstance[] = [];
        const linkInst: Cesium.GeometryInstance[] = [];
        const laneInst: Cesium.GeometryInstance[] = [];
        const lineInst: Cesium.GeometryInstance[] = [];
        for (const id of home.linkIds) {
            const link = this.cachedLinkMap.get(id);
            if (!link) continue;
            if (edit.editedLinkIds.has(id) || edit.deletedLinkIds.has(id)) {
                // 마스킹 — 픽 속성 맵에서도 제거 (안 보이는 옛 형상이 선택되는 것 방지)
                if (link.__guid) {
                    networkPrimitivePropertiesMap.delete(link.__guid);
                    for (const lane of link.lanes ?? []) {
                        if (lane?.__guid) networkPrimitivePropertiesMap.delete(lane.__guid);
                    }
                }
                continue;
            }
            this.buildLinkInstances(link, this.cachedNodeMap, outlineInst, linkInst, laneInst, lineInst, lineInst);
        }
        this.buildChunkPrimitives(key, outlineInst, linkInst, laneInst, lineInst);
        if (tier != null) this.chunkTiers.set(key, tier);
    }

    /** 편집 델타 오버레이 재구성 (타일 모드) — store 의 편집 링크를 새 형상으로 렌더.
     *  2D renderEditOverlay 의 3D 대응. 저장/폐기 시 editedLinkIds 가 비어 자동 제거된다. */
    private rebuildEditOverlay(): void {
        for (const p of this.editOverlayPrims) {
            try { this.viewer.scene.groundPrimitives.remove(p); } catch (_) { /* noop */ }
        }
        this.editOverlayPrims = [];
        if (this.destroyed) return;
        if (!NETWORK_TILING.ENABLED && !useNetworkTileStore.getState().tileMode) return; // 전체 로드는 fullBuild 가 반영
        const edited = useNetworkEditStore.getState().editedLinkIds;
        (globalThis as any).__netEditOverlay3D = 0; // 디버그/E2E 관측용
        if (edited.size === 0) { try { this.viewer.scene.requestRender(); } catch (_) { /* noop */ } return; }

        const store = layerNameToStoreMap[this.LAYER_NAME];
        const net: any = store?.getState()?.currentJsonData;
        if (!net?.links) return;
        const nodeMap = new Map<string, any>(
            (net.nodes ?? []).filter(Boolean).map((n: any) => [String(n.id), n]));
        // 편집 링크 끝 노드가 store 에 없을 수 있어(경계) 캐시 노드로 보강
        for (const [id, n] of this.cachedNodeMap) if (!nodeMap.has(id)) nodeMap.set(id, n);

        const outlineInst: Cesium.GeometryInstance[] = [];
        const linkInst: Cesium.GeometryInstance[] = [];
        const laneInst: Cesium.GeometryInstance[] = [];
        const lineInst: Cesium.GeometryInstance[] = [];
        for (const link of net.links) {
            if (!link || !edited.has(String(link.id))) continue;
            this.buildLinkInstances(link, nodeMap, outlineInst, linkInst, laneInst, lineInst, lineInst);
        }
        const mk = (inst: Cesium.GeometryInstance[]) => new Cesium.GroundPrimitive({
            geometryInstances: inst,
            appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: false }),
            asynchronous: true,
            classificationType: Cesium.ClassificationType.BOTH,
        });
        if (outlineInst.length > 0) this.editOverlayPrims.push(mk(outlineInst));
        if (linkInst.length > 0)    this.editOverlayPrims.push(mk(linkInst));
        if (laneInst.length > 0)    this.editOverlayPrims.push(mk(laneInst));
        if (lineInst.length > 0) {
            this.editOverlayPrims.push(new Cesium.GroundPolylinePrimitive({
                geometryInstances: lineInst,
                appearance: new Cesium.PolylineColorAppearance(),
                asynchronous: true,
                classificationType: Cesium.ClassificationType.BOTH,
            }));
        }
        for (const p of this.editOverlayPrims) this.viewer.scene.groundPrimitives.add(p);
        this.pumpUntilReady(this.editOverlayPrims as any);
        (globalThis as any).__netEditOverlay3D = this.editOverlayPrims.length;
        try { this.viewer.scene.requestRender(); } catch (_) { /* noop */ }
    }

    /** 모든 청크 Primitive 제거 */
    private removeAllChunkPrimitives(): void {
        for (const chunk of this.chunkPrimitives.values()) {
            if (chunk.outline) this.viewer.scene.groundPrimitives.remove(chunk.outline);
            if (chunk.link)    this.viewer.scene.groundPrimitives.remove(chunk.link);
            if (chunk.lane)    this.viewer.scene.groundPrimitives.remove(chunk.lane);
            if (chunk.line)    this.viewer.scene.groundPrimitives.remove(chunk.line);
        }
        this.chunkPrimitives.clear();
        this.chunkCenters.clear();
        this.chunkTiers.clear();
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
        // links/lanes 는 applyVisibility 가 Primitive show 로 처리.
        // nodes/ports/connections 엔티티는 featureType별 show 를 직접 토글 (토글 시 1회 순회).
        if (featureType === 'nodes' || featureType === 'ports' || featureType === 'connections') {
            const now = Cesium.JulianDate.now();
            for (const ent of this.dataSource.entities.values) {
                const ft = ent.properties?.getValue?.(now)?.featureType;
                if (ft === featureType) ent.show = visible;
            }
        }
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

        // 캐시 증분 갱신 (null 요소 방어 포함)
        for (const i of changedNodeIndices) {
            const node = next.nodes[i];
            if (node) this.cachedNodeMap.set(String(node.id), node);
        }
        for (const node of newNodes) if (node) this.cachedNodeMap.set(String(node.id), node);
        for (const link of newLinks) if (link) this.cachedLinkMap.set(String(link.id), link);

        // 새 링크가 있으면 청크별 Primitive 전체 재빌드
        if (newLinks.length > 0) {
            networkPrimitivePropertiesMap.clear();
            this.lanePositionMap.clear();

            const chunkOutline = new Map<string, Cesium.GeometryInstance[]>();
            const chunkLink    = new Map<string, Cesium.GeometryInstance[]>();
            const chunkLane    = new Map<string, Cesium.GeometryInstance[]>();
            const chunkLine    = new Map<string, Cesium.GeometryInstance[]>();
            this.clearRoadOverview();
            for (const link of next.links) {
                if (!link) continue; // null 요소 방어
                const key = this.linkChunkKey(link);
                if (!chunkOutline.has(key)) {
                    chunkOutline.set(key, []); chunkLink.set(key, []); chunkLane.set(key, []); chunkLine.set(key, []);
                }
                const lineArr = chunkLine.get(key)!;
                this.buildLinkInstances(link, this.cachedNodeMap,
                    chunkOutline.get(key)!, chunkLink.get(key)!, chunkLane.get(key)!, lineArr, lineArr);
                this.addRoadOverviewPolyline(link);
            }
            this.commitRoadOverview();
            this.removeAllChunkPrimitives();
            for (const key of chunkOutline.keys()) {
                this.buildChunkPrimitives(key, chunkOutline.get(key)!, chunkLink.get(key)!, chunkLane.get(key)!, chunkLine.get(key)!);
            }
            this.applyVisibility();
        }

        // 변경·추가된 노드의 Entity 처리
        this.dataSource.entities.suspendEvents();
        try {
            for (const node of newNodes) {
                if (!node) continue; // null 요소 방어
                this.buildNodeEntities(node, this.cachedLinkMap, this.cachedNodeMap);
            }
            for (const i of changedNodeIndices) {
                const prevNode = prev.nodes[i];
                const nextNode = next.nodes[i];
                if (!prevNode || !nextNode) continue; // null 요소 방어
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

        // GroundPrimitive(지형 클램프) 사용 — 절대고도(height) 지정 불필요.
        // 이전의 avgTerrainH+ε 방식은 지형 샘플링 실패/불일치 시 도로가 지형에 묻히거나
        // 땅속 투과로 보이는 원인이었음. 레이어링은 groundPrimitives 추가 순서로 유지.

        // 좌표 정제: NaN → 근접중복(<0.5m) → **급반전점(>150° 꺾임)** 제거.
        // KTDB 클러스터 병합 좌표에 왕복 접힌 점이 섞이면 offset 접선이 무너져
        // 차선 구분선이 직각 ㄱ자로 꺾이고("방향 안 맞음") corridor 스파이크가 생긴다.
        // corridor/lane/divider 가 전부 같은 정제 좌표를 쓰도록 여기서 일괄 정제.
        const MIN_LINK_DIST = 0.5;
        const raw = link.coordinates.filter((c: any) => c && isFinite(c.lng) && isFinite(c.lat));
        if (raw.length < 2) return;
        const dedup: any[] = [raw[0]];
        for (let i = 1; i < raw.length; i++) {
            const p = dedup[dedup.length - 1];
            const dx = (raw[i].lng - p.lng) * 88000, dy = (raw[i].lat - p.lat) * 111000;
            if (dx * dx + dy * dy >= MIN_LINK_DIST * MIN_LINK_DIST) dedup.push(raw[i]);
        }
        const validCoords: any[] = dedup.length <= 2 ? dedup : [dedup[0]];
        for (let i = 1; i < dedup.length - 1; i++) {
            const a = validCoords[validCoords.length - 1], b = dedup[i], c = dedup[i + 1];
            const v1x = (b.lng - a.lng) * 88000, v1y = (b.lat - a.lat) * 111000;
            const v2x = (c.lng - b.lng) * 88000, v2y = (c.lat - b.lat) * 111000;
            const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
            if (m1 > 0 && m2 > 0 && (v1x * v2x + v1y * v2y) / (m1 * m2) < -0.87) continue; // cos150°
            validCoords.push(b);
        }
        if (dedup.length > 2) validCoords.push(dedup[dedup.length - 1]);
        if (validCoords.length < 2) return;
        const linkPositions: Cesium.Cartesian3[] = validCoords.map((c: any) =>
            Cesium.Cartesian3.fromDegrees(c.lng, c.lat)
        );

        const roadWidth = link.width ?? 7;

        // ── 중앙정렬 (2D/백엔드 규약과 통일) ──────────────────────
        // 링크 shape = 그 방향 도로의 중심선. KTDB 상하행 역방향 링크쌍 실측(301쌍):
        // 지오메트리 공유 0건, 전부 자체 중심선(이격 중앙값 12m) → 우측 반폭 시프트는
        // 이중 시프트가 되어 커넥션/포트/정지선/2D MVT(모두 중앙정렬)와 반폭 어긋났음.
        // OSM 변환 왕복(지오메트리 공유)은 겹쳐 보이지만 2D와 동일한 기존 모습(좌우 일관).
        const shiftedCenter = this.computeOffsetPositions(validCoords, 0);

        // ── 1. 외곽 그림자 (도로 폭보다 약간 크게, 어두운 색) ─────
        linkOutlineInstances.push(new Cesium.GeometryInstance({
            id: `${link.__guid}_outline`,
            geometry: new Cesium.CorridorGeometry({
                positions: shiftedCenter,
                width: roadWidth + 1.2,
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
                positions: shiftedCenter,
                width: roadWidth,
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
            // 차선 0 = 최좌측(중앙선 쪽) — 2D lane-edit·백엔드 커넥션 shape 규약과 동일.
            // right(+) 법선 기준이므로 좌측은 음수: (i - (n-1)/2). 중앙정렬(dirOffset 없음).
            const lateralOffset = (i - (laneCount - 1) / 2) * laneWidth;

            const lanePositions = this.computeOffsetPositions(validCoords, lateralOffset);
            this.lanePositionMap.set(`${link.id}_${i}`, {
                source: lanePositions[0]!,
                target: lanePositions[lanePositions.length - 1]!,
            });

            // ── 3. 레인 채움면(교차 음영) 제거 ──────────────────
            // 좁고 긴 corridor 분류볼륨은 카메라 각도에 따라 회색면이 뒤틀려 보이는
            // 시점 의존 아티팩트의 진원지 ("회색부분이 카메라 따라 돌아감" 실사용 보고).
            // 차선 구분은 흰 구분선+황 중앙선(GroundPolyline, 안정적)으로 표현 — 시뮬레이터 표준.
            // lane 속성 조회는 링크 pick → 링크 속성의 lanes 로 접근 가능.
            networkPrimitivePropertiesMap.set(lane.__guid, { ...lane, featureType: "lanes", linkRef: link.id });

            // ── 4. 차선 구분선 (흰색, GroundPolyline 픽셀 폭) ──
            // 0.15m corridor 분류볼륨은 시선각 따라 슬리버로 투영되어
            // "카메라 방향에 따라 형상이 바뀌는" 아티팩트 → 폴리라인으로 대체
            if (i < link.lanes.length - 1 && lane.__guid) {
                const boundaryOffset = lateralOffset + laneWidth / 2; // i와 i+1(더 우측) 사이 경계
                const boundaryPositions = this.computeOffsetPositions(validCoords, boundaryOffset);
                dividerInstances.push(new Cesium.GeometryInstance({
                    id: `${lane.__guid}_divider`,
                    geometry: new Cesium.GroundPolylineGeometry({
                        positions: boundaryPositions,
                        width: 1.5, // px
                    }),
                    attributes: {
                        color: Cesium.ColorGeometryInstanceAttribute.fromColor(
                            NetworkDataSourceLayer.COLOR_DIVIDER
                        ),
                    },
                }));
            }
        }

        // ── 5. 중앙선 (황색, GroundPolyline 픽셀 폭) ──────────────
        // 중앙정렬 렌더에서 방향성 링크의 중앙선(대향차로 경계) = 좌측 가장자리 = -rw/2
        if (laneCount >= 2) {
            const centerPositions = this.computeOffsetPositions(validCoords, -roadWidth / 2);
            centerLineInstances.push(new Cesium.GeometryInstance({
                id: `${link.__guid}_center`,
                geometry: new Cesium.GroundPolylineGeometry({
                    positions: centerPositions,
                    width: 2, // px
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
    /** 노드/포트/커넥션 엔티티 컬링 — 카메라 600m 이내만 렌더 ("가까운 것만" 표시, LRU 잔존 부하 차단) */
    private static readonly NODE_ENTITY_DDC = new Cesium.DistanceDisplayCondition(0, 600);

    private buildNodeEntities(node: any, linkMap: Map<string, any>, nodeMap: Map<string, any>): void {
        if (!node.coordinates?.lng || !node.coordinates?.lat) return;
        const ids: string[] = [];
        const position = Cesium.Cartesian3.fromDegrees(node.coordinates.lng, node.coordinates.lat);

        this.dataSource.entities.add(new Cesium.Entity({
            id: node.__guid,
            position,
            show: this.featureTypeVisible['nodes'] ?? true,
            cylinder: {
                length: 5.0,
                topRadius: 0.5,
                bottomRadius: 0.5,
                material: Cesium.Color.YELLOW,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                distanceDisplayCondition: NetworkDataSourceLayer.NODE_ENTITY_DDC,
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
                show: this.featureTypeVisible['ports'] ?? true,
                cylinder: {
                    length: 2,
                    topRadius: port.type === 'in' ? 1.5 : 0.1,
                    bottomRadius: port.type === 'in' ? 0.1 : 1.5,
                    material: port.type === 'out'
                        ? Cesium.Color.CYAN.withAlpha(0.8)
                        : Cesium.Color.MAGENTA.withAlpha(0.8),
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    distanceDisplayCondition: NetworkDataSourceLayer.NODE_ENTITY_DDC,
                },
                properties: port,
            }));
            ids.push(port.__guid);
        }

        for (const conn of (node.connections ?? [])) {
            if (this.addConnectionEntity(conn, node) && conn.__guid) ids.push(conn.__guid as string);
        }

        this.nodeEntityIds.set(String(node.id), ids);
    }

    /** 커넥션 엔티티를 실제로 추가했으면 true. fromLink/toLink 가 아직 캐시에 없어(로딩 중이거나
     *  이웃 타일 소유) 스킵한 경우 false 를 반환하고, 그 링크가 나중에 들어오면
     *  retryPendingConnections 가 재시도할 수 있도록 등록해둔다. */
    private addConnectionEntity(conn: any, node: any): boolean {
        const fromLink = this.cachedLinkMap.get(String(conn.fromLink));
        const toLink = this.cachedLinkMap.get(String(conn.toLink));
        if (!fromLink || !toLink || !conn.__guid) {
            if (conn.__guid) {
                if (!fromLink) this.registerPendingConnection(String(conn.fromLink), conn, node);
                if (!toLink) this.registerPendingConnection(String(conn.toLink), conn, node);
            }
            return false;
        }

        const isStraight = normalizeTurning(conn.turning) === 'Straight';
        // 3점 이상 = 변환기가 내부링크 경로(교통섬 순환·회전 동선)로 생성한 폴리라인 —
        // 회전 커넥션만 사용(완만한 실측은 그대로, 급꺾임은 코너 스무딩). 직진은 원본에
        // 중간 경유점이 있어도 여러 차선이 같은 경유점으로 합성돼(KTDB 내부링크 생성 시
        // 차선별 분리 없이 공유) 교차로 중앙에서 겹쳐 보이는 인공물이 되므로, 직진은
        // 항상 시작~끝 2점 직선으로 그린다(실사용 발견).
        let positions: Cesium.Cartesian3[] | null = null;
        if (!isStraight && conn.coordinates?.length > 2) {
            const pts = smoothSharpPolyline(conn.coordinates.filter((c: any) => c && c.lng != null && c.lat != null));
            if (pts.length >= 2) {
                positions = pts.map((c: any) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat));
            }
        }
        if (!positions) {
            let fromPt: Cesium.Cartesian3;
            let toPt: Cesium.Cartesian3;

            if (conn.coordinates?.length >= 2) {
                const c0 = conn.coordinates[0];
                const cL = conn.coordinates[conn.coordinates.length - 1];
                if (!c0 || !cL) return false;
                fromPt = Cesium.Cartesian3.fromDegrees(c0.lng, c0.lat);
                toPt = Cesium.Cartesian3.fromDegrees(cL.lng, cL.lat);
            } else {
                const fromPos = this.lanePositionMap.get(`${String(fromLink.id)}_${conn.fromLane}`);
                const toPos = this.lanePositionMap.get(`${String(toLink.id)}_${conn.toLane}`);
                if (!fromPos || !toPos) return false;
                fromPt = fromPos.target;
                toPt = toPos.source;
            }

            const ctrlPt = node.coordinates?.lng && node.coordinates?.lat
                ? Cesium.Cartesian3.fromDegrees(node.coordinates.lng, node.coordinates.lat)
                : Cesium.Cartesian3.midpoint(fromPt, toPt, new Cesium.Cartesian3());
            positions = isStraight
                ? [fromPt, toPt]
                : this.generateQuadraticBezierCurve(fromPt, ctrlPt, toPt);
        }

        this.dataSource.entities.add({
            id: conn.__guid as string,
            show: this.featureTypeVisible['connections'] ?? true,
            polyline: {
                positions,
                width: 5,
                arcType: Cesium.ArcType.GEODESIC,
                material: new Cesium.PolylineArrowMaterialProperty(Cesium.Color.WHITE.withAlpha(0.8)),
                clampToGround: true,
                distanceDisplayCondition: NetworkDataSourceLayer.NODE_ENTITY_DDC,
            },
            properties: conn,
        });
        return true;
    }

    private registerPendingConnection(linkId: string, conn: any, node: any): void {
        let list = this.pendingConnectionsByLink.get(linkId);
        if (!list) { list = []; this.pendingConnectionsByLink.set(linkId, list); }
        list.push({ conn, node });
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
        if (this.pickRetryTimer) { clearTimeout(this.pickRetryTimer); this.pickRetryTimer = null; }
        if (this.pumpTimer) { clearInterval(this.pumpTimer); this.pumpTimer = null; }
        if (this.applyVisDebounce) { clearTimeout(this.applyVisDebounce); this.applyVisDebounce = null; }
        if (this.nodeBuildRaf != null) { cancelAnimationFrame(this.nodeBuildRaf); this.nodeBuildRaf = null; }
        this.nodeBuildQueue.clear();
        this.tileManager?.clear();
        this.tileManager = null;
        // 레이어 제거 시 지형 depth test 복원
        try { this.viewer.scene.globe.depthTestAgainstTerrain = true; } catch (_) {}
        this.unsubscribe?.();
        this.unsubscribeDraw?.();
        this.unsubscribeTileMode?.();
        this.unsubscribeEdit?.();
        this.unsubscribeChanged?.();
        for (const p of this.editOverlayPrims) {
            try { this.viewer.scene.groundPrimitives.remove(p); } catch (_) { /* noop */ }
        }
        this.editOverlayPrims = [];
        if (this.highlightPrimitive) {
            try { this.viewer.scene.groundPrimitives.remove(this.highlightPrimitive); } catch (_) {}
            this.highlightPrimitive = null;
        }
        this.removeAllChunkPrimitives();
        this.clearRoadOverview();
        if (this.dataSource) {
            this.viewer.dataSources.remove(this.dataSource, true);
        }
        if (highlightNetworkPrimitive === this.highlightInstance) {
            highlightNetworkPrimitive = null;
        }
        // 선택 슬롯 정리 + 전역 API 해제
        this.clearSelectionHighlightInstance();
        setNetworkSelectionHighlight = null;
        clearNetworkSelectionHighlight = null;
        networkPrimitivePropertiesMap.clear();
    }
}
