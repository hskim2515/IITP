import VectorLayer from "ol/layer/Vector";
import { getActiveVersionId } from "@utils/versionId";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { LineString, Point, Polygon } from "ol/geom";
import { fromLonLat } from "ol/proj";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { Coordinate } from "ol/coordinate";
import { Network } from "@type/Network";
import { FeatureLike } from "ol/Feature";
import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import { useModeStore } from "@stores/useModeStore";
import { useNetworkEditStore } from "@stores/useNetworkEditStore";
import { usePropertyStore } from "@stores/usePropertyStore";
import {
    getNetworkLodTierByResolution,
    isNetworkFeatureVisibleAtTier,
    NETWORK_EXTENT_GATING,
    type NetworkLodTier,
} from "@utils/lodConstants";
import { buffer, containsCoordinate, createEmpty, extend, getHeight, getWidth, intersects, type Extent } from "ol/extent";
import { unByKey } from "ol/Observable";
import type { EventsKey } from "ol/events";
import type OLMap from "ol/Map";
import { NETWORK_TILING } from "@utils/lodConstants";
import { NetworkTileManager, type NetworkTilePayload } from "@managers/NetworkTileManager";
import { assignTileGuids } from "@utils/tileGuid";
import { smoothSharpPolyline } from "@utils/polylineSmooth";
import { normalizeTurning } from "@utils/turning";
import NetworkMvtLayer from "@features/NetworkMvtLayer";
import { useNetworkTileStore } from "@stores/useNetworkTileStore";

export default class NetworkFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;

    private unsubscribe: (() => void) | undefined;
    private unsubscribeDraw: (() => void) | undefined;
    private unsubscribeMode: (() => void) | undefined;
    private showDetail: boolean = false;

    // 증분 업데이트용 상태
    private prevNetwork: Network | null = null;
    private linkFeaturesMap: Map<string, Feature[]> = new Map(); // linkId → features
    private nodeFeaturesMap: Map<string, Feature[]> = new Map(); // nodeId → features
    private laneMap: Map<string, Feature> = new Map();           // `${linkId}_${laneIdx}` → lane feature
    private lastImportEpoch = 0;  // 마지막으로 처리한 importEpoch
    // 캐시 Map: fullBuild에서 생성, incrementalUpdate에서 증분 갱신
    private cachedNodeMap: Map<string, any> = new Map();
    private cachedLinkMap: Map<string, any> = new Map();

    // ── Extent 게이팅 상태 ──
    // linkFeaturesMap/nodeFeaturesMap은 "전체 빌드된 피처"의 메모리 캐시이고,
    // 아래 구조는 그중 "현재 source(=화면)에 실제 올라가 있는 부분집합"을 추적한다.
    private linkExtentMap: Map<string, Extent> = new Map();        // linkId → 링크 전체 bbox (3857)
    private nodeCoordMap: Map<string, Coordinate> = new Map();     // nodeId → 노드 점 좌표 (3857)
    private addedLinkFeatures: Map<string, Feature[]> = new Map(); // linkId → 현재 source에 올라간 피처
    private addedNodeFeatures: Map<string, Feature[]> = new Map(); // nodeId → 현재 source에 올라간 피처
    private lastTier: NetworkLodTier | null = null;
    private moveEndKey: EventsKey | null = null;
    /** 타일 매니저가 바라보는 versionId — 세션 중 버전 전환 감지용 */
    private tileVersionId: string | null = null;
    private visChangeKey: EventsKey | null = null;
    // 편집 델타 오버레이: editedLinkIds 링크를 MVT 위에 OL 벡터로 그리는 전용 레이어(this.source 와 분리).
    private editOverlaySource: VectorSource | null = null;
    private editOverlayLayer: VectorLayer | null = null;
    private unsubscribeEdit: (() => void) | undefined;
    private unsubscribeChanged: (() => void) | undefined;
    private prevIsChanged = false;
    // 선택 하이라이트 오버레이: selectedProps(링크/레인)를 좌표 기반으로 그리는 전용 레이어(2D, MVT 위).
    private selHighlightSource: VectorSource | null = null;
    private selHighlightLayer: VectorLayer | null = null;
    private unsubscribeSel: (() => void) | undefined;

    // ── 타일링 상태 (NETWORK_TILING.ENABLED 일 때만 사용; 읽기 전용 뷰) ──
    // 타일 경계 링크/노드는 여러 타일에 중복 등장 → id별 refcount 로 마지막 타일 evict 시에만 destroy.
    private tileManager: NetworkTileManager | null = null;
    private linkRefCount: Map<string, number> = new Map();
    private nodeRefCount: Map<string, number> = new Map();
    // MVT 레이어 (2D 네트워크 도로/차선, NETWORK_TILING.USE_MVT_2D 일 때)
    private mvtLayer: NetworkMvtLayer | null = null;
    // 타일 모드 store 동기화 debounce 타이머
    private storeSyncTimer: ReturnType<typeof setTimeout> | null = null;
    // overview/mid(JSON fetch 동결) 진입 전 마지막으로 실제 fetch 했던 화면 범위 — 편집 그리드
    // "이 데이터는 이전 화면 범위 것" 안내 배너가 현재 뷰와 겹치는지 판정하는 데 쓰인다.
    private lastLoadedExtent: Extent | null = null;

    private readonly LAYER_NAME = "network";

    private static readonly CELL_WIDTH_RATIO = 0.25;
    private static readonly SEGMENT_WIDTH_RATIO = 0.4;

    private static readonly EPS = 1e-9;
    /** 진행방향 화살표 배치 간격(m, OL 투영 단위 ≈ m) — 3D(NetworkDataSourceLayer)와 동일 값 */
    private static readonly ARROW_INTERVAL_M = 25;

    private static readonly PORT_ICON_SCALE = 2.0;
    private static readonly NODE_RADIUS_SCALE = 0.8;
    private static readonly NODE_STROKE_SCALE = 0.1;

    // zIndex 맵
    private zIndexMap: Record<string, number> = {
        "links": 10,
        "link-edit": 110,
        "lanes": 20,
        "lane-edit": 120,
        "cells": 25,
        "segments": 26,
        "connections": 30,
        "ports": 160,
        "nodes": 200,
    };

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            style: (feature, resolution) => this.styleFunction(feature, resolution),
            zIndex: 300,
        });

        this.source = source;
        this.load();

        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribe = store.subscribe(
                (state: { currentJsonData: Network; }) => state.currentJsonData,
                () => { this.updateEditDeltas(); this.renderEditOverlay(); this.load(); },
                { equalityFn: (a:Network, b:Network) => a === b }
            );
            // 저장/폐기(isChanged true→false) 감지 → 편집 델타 정리 + 서버 데이터 새로고침.
            this.prevIsChanged = !!(store.getState() as any).isChanged;
            this.unsubscribeChanged = store.subscribe(
                (state: any) => !!state.isChanged,
                (isChanged: boolean) => {
                    if (this.prevIsChanged && !isChanged) this.onEditsCleared();
                    this.prevIsChanged = isChanged;
                },
            );
        }

        // 도로 그리기 종료 시 fullBuild (draw 중 incremental 누적 후 정리)
        // 편집 모드 전환 시 즉시 viewport 타일 갱신 — updateTiles 는 moveend 에만 걸려 있어,
        // 편집 모드로 바꾼 직후에는 팬/줌을 하기 전까지 store 가 비어 클릭 선택이 아무것도
        // 못 잡던 문제(실사용 재현)의 원인. 모드가 바뀌면 fetch 게이트(near부터)가 달라지므로
        // 그 자리에서 바로 타일을 당겨온다.
        // (useModeStore 는 subscribeWithSelector 미들웨어가 없는 일반 스토어 — 수동 prev 비교)
        let prevAppMode = useModeStore.getState().appMode;
        this.unsubscribeMode = useModeStore.subscribe((s) => {
            if (s.appMode === prevAppMode) return;
            prevAppMode = s.appMode;
            const map = this.getMapInternal();
            if (map) { try { this.updateTiles(map); } catch (_) { /* noop */ } }
        });

        this.unsubscribeDraw = useNetworkDrawStore.subscribe(
            (state, prevState) => {
                const wasDrawing = prevState.isActive || prevState.isConnectionActive;
                const isDrawing  = state.isActive   || state.isConnectionActive;
                if (wasDrawing && !isDrawing) {
                    this.prevNetwork = null; // force fullBuild to clean up any inconsistency
                    this.load();
                }
            }
        );

        // 레이어가 숨김→표시로 바뀔 때 현재 화면에 맞춰 source를 채운다 (숨김 중엔 reconcile 생략)
        // 타일 모드에서는 타일 매니저가 source를 관리하므로 extent 게이팅 구독은 생략.
        if (NETWORK_EXTENT_GATING.ENABLED && !NETWORK_TILING.ENABLED) {
            this.visChangeKey = this.on('change:visible', () => {
                if (this.getVisible()) this.reconcile();
            });
        }
    }

    /**
     * 네트워크 교체(임포트) 후 호출 — MVT 타일 캐시 무효화 + JSON viewport 타일 재fetch.
     * 없으면 OL VectorTile 내부 캐시의 이전 네트워크 타일이 새 데이터와 섞여 표시된다.
     */
    public refreshNetworkTiles(): void {
        try { this.mvtLayer?.refreshTiles(); } catch (_) {}
        try { this.tileManager?.clear(); } catch (_) {}
        const map = this.getMapInternal();
        if (map) { try { this.updateTiles(map); } catch (_) {} }
        try { map?.render(); } catch (_) {}
    }

    /** OL이 레이어를 map에 추가/제거할 때 호출. moveend 구독을 붙이고 초기 갱신 수행. */
    override setMapInternal(map: OLMap | null): void {
        if (this.moveEndKey) { unByKey(this.moveEndKey); this.moveEndKey = null; }
        super.setMapInternal(map);
        if (!map) {
            this.tileManager?.clear();
            this.tileManager = null;
            if (this.mvtLayer) { try { this.mvtLayer.setMap(null); } catch (_) {} this.mvtLayer = null; }
            return;
        }
        // MVT 레이어 부착 (2D 네트워크 도로/차선, 전 줌 LOD). 가시성은 네트워크 레이어와 동기화.
        if (NETWORK_TILING.USE_MVT_2D && !this.mvtLayer) {
            const versionId = getActiveVersionId();
            const base = import.meta.env.VITE_API_URL ?? "";
            if (versionId) {
                this.mvtLayer = new NetworkMvtLayer(String(versionId), String(base));
                this.mvtLayer.setVisible(this.getVisible());
                map.addLayer(this.mvtLayer);
                if (!this.visChangeKey) {
                    this.visChangeKey = this.on('change:visible', () => {
                        this.mvtLayer?.setVisible(this.getVisible());
                        this.editOverlayLayer?.setVisible(this.getVisible());
                        this.selHighlightLayer?.setVisible(this.getVisible());
                    });
                }
            }
        }
        // 편집 델타 오버레이 레이어 부착 (MVT 위, editedLinkIds 링크만 그림).
        if (NETWORK_TILING.ENABLED && !this.editOverlayLayer) {
            this.editOverlaySource = new VectorSource();
            this.editOverlayLayer = new VectorLayer({
                source: this.editOverlaySource,
                style: (f, resolution) => this.editOverlayStyle(f as Feature, resolution),
                zIndex: 120, // MVT/도로 위, 편집 요소(노드 등)와 비슷한 층
            });
            this.editOverlayLayer.setVisible(this.getVisible());
            map.addLayer(this.editOverlayLayer);
            // 편집 델타 변경 시 오버레이 재렌더(edited) + MVT 재렌더(deleted 마스킹 반영).
            const unsubEdited = useNetworkEditStore.subscribe(
                (s) => s.editedLinkIds,
                () => {
                    this.renderEditOverlay();
                    // 수정 링크는 MVT 에서 숨김(styleFunction) → 집합 변경 시 MVT 리렌더 필요
                    try { this.mvtLayer?.changed(); } catch (_) {}
                },
                { equalityFn: (a, b) => a === b },
            );
            const unsubDeleted = useNetworkEditStore.subscribe(
                (s) => s.deletedLinkIds,
                () => { try { this.mvtLayer?.changed(); } catch (_) {} try { this.getMapInternal()?.render(); } catch (_) {} },
                { equalityFn: (a, b) => a === b },
            );
            // 노드 편집(커넥션 생성/삭제·이동·포트 재배선) → 해당 노드의 OL 피처(노드 점·커넥션
            // 곡선·포트) 즉시 재빌드. 피처는 타일 페이로드 기준으로 빌드되어 store 편집이
            // 반영되지 않던 문제(커넥션 지워도 곡선 잔존) 해결.
            const unsubNodeEdits = useNetworkEditStore.subscribe(
                (s) => [s.editedNodeIds, s.deletedNodeIds] as const,
                ([edited, deleted]) => this.refreshEditedNodeFeatures(edited, deleted),
                { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] },
            );
            this.unsubscribeEdit = () => { unsubEdited(); unsubDeleted(); unsubNodeEdits(); };
            this.renderEditOverlay();
        }

        // 선택 하이라이트 오버레이 (2D, MVT 위). selectedProps(링크/레인) 좌표 기반 강조.
        if (!this.selHighlightLayer) {
            this.selHighlightSource = new VectorSource();
            this.selHighlightLayer = new VectorLayer({
                source: this.selHighlightSource,
                style: (f) => this.selHighlightStyle(f as Feature),
                zIndex: 350, // MVT(295)·네트워크 벡터(300) 위 — 레인 폴리곤 fill 이 MVT 차선에 안 가리게
            });
            this.selHighlightLayer.setVisible(this.getVisible());
            map.addLayer(this.selHighlightLayer);
            this.unsubscribeSel = usePropertyStore.subscribe(
                (s: any) => s.selectedProps,
                () => this.renderSelHighlight(),
                { equalityFn: (a: any, b: any) => a === b },
            );
            this.renderSelHighlight();
        }

        if (NETWORK_TILING.ENABLED) {
            // 타일 모드: viewport 단위 fetch + evict (광역권→전국, 읽기 전용)
            this.moveEndKey = map.on('moveend', () => this.updateTiles(map));
            this.updateTiles(map);
        } else if (NETWORK_EXTENT_GATING.ENABLED) {
            // 상호작용이 끝난 후(정착 시)에만 1회 실행 → pan/zoom 중 비용 0
            this.moveEndKey = map.on('moveend', () => this.reconcile());
            this.reconcile();
        }
    }

    // ─────────────────────────── 타일 모드 (읽기 전용) ───────────────────────────
    // ⚠️ 편집(선택/수정/삭제/추가)은 전체-로드 경로 전제. 타일 모드는 뷰 전용이며
    //    feature 에 __guid 가 부여되지 않아 기본-모드 선택 대상이 아니다. (docs/network-bbox-tiling-design.md)

    private updateTiles(map: OLMap): void {
        const view = map.getView();
        const size = map.getSize();
        const resolution = view.getResolution();
        if (!size || resolution == null) return;
        const extent = view.calculateExtent(size);

        // [PoC] MVT 모드: 편집요소 데이터(노드/커넥션/포트) 확보용 viewport 타일 fetch 게이트.
        //   보기 모드: detail(완전 근접)에서만 — 도로/차선은 MVT 전담이라 그 외 불필요(메모리 절약).
        //   편집 모드: near 부터 — 그리기 스냅·기존 링크 분할·커넥션 편집이 store 의 기존 네트워크
        //   데이터를 필요로 하는데, detail 전용이면 통상 편집 줌(near)에서 store 가 비어
        //   기존 네트워크와 상호작용 불가(신규 도로만 그려짐)했던 근본 원인.
        if (NETWORK_TILING.USE_MVT_2D) {
            const tier = getNetworkLodTierByResolution(resolution);
            const editMode = useModeStore.getState().appMode === 'edit';
            const fetchOk = tier === 'detail' || (editMode && tier === 'near');
            if (!fetchOk) {
                // ⚠️ 예전엔 여기서 tileManager.clear()로 cachedLinkMap/cachedNodeMap을 비웠는데,
                // 이 캐시가 그대로 편집 그리드(PropertyPanel→DrilldownGrid)의 rowData 원천이라
                // 줌아웃하면 그리드가 텅 비어버리는 부작용이 있었다(사용자 보고). MVT가 지도
                // 렌더링은 계속 담당하므로 여기서는 fetch만 건너뛰고 캐시는 그대로 둔다 — 그리드는
                // "마지막으로 불러온 화면 범위" 데이터를 계속 보여준다. 대신 그 사실과, 현재 화면이
                // 그 범위를 벗어났는지를 store로 알려 UI(그리드 상단 배너)가 안내하게 한다.
                const outOfRange = this.lastLoadedExtent ? !intersects(extent, this.lastLoadedExtent) : true;
                useNetworkTileStore.getState().setGridDataStatus(true, outOfRange);
                return;
            }
        }
        useNetworkTileStore.getState().setGridDataStatus(false, false);

        // 활성 그리기/커넥션/배치 중에만 타일 갱신 동결 — 진행 중 편집 대상이 evict/덮어써지는 것 방지.
        //   ⚠️ 선택 모드(isSelectActive)는 동결하지 않는다. 동결하면 팬/줌 시 새 지역 타일이 안 와
        //   cachedLinkMap→store 가 비어 **기존 링크 선택 불가**. (편집 링크는 scheduleStoreSync 병합이 보존)
        const draw = useNetworkDrawStore.getState();
        if (draw.isActive || draw.isConnectionActive || draw.placementMode !== 'none') return;

        const versionId = getActiveVersionId();
        if (!versionId) return; // 시나리오 미선택 시 fetch 불가
        // 버전 전환 감지 — 매니저는 생성 시 versionId 고정. 세션 중 활성 버전이 바뀌면
        // (저장 후 새 버전 활성화 등) 이전 버전 타일을 계속 fetch/표시하므로 재생성 + MVT 캐시 무효화.
        if (this.tileManager && this.tileVersionId !== String(versionId)) {
            this.tileManager.clear();
            this.tileManager = null;
            try { this.mvtLayer?.refreshTiles(); } catch (_) {}
            this.lastLoadedExtent = null; // 버전이 바뀌었으니 이전 범위 비교는 무의미
        }
        this.tileVersionId = String(versionId);
        if (!this.tileManager) {
            this.tileManager = new NetworkTileManager(String(versionId), {
                onTileLoaded: (_k, payload) => this.addTilePayload(payload),
                onTileEvicted: (_k, payload) => this.removeTilePayload(payload),
            });
        }
        this.lastLoadedExtent = extent;
        this.tileManager.update(extent, resolution);
    }

    /** 타일 페이로드 → cached 맵 병합 + refcount + 신규 id만 피처 빌드 후 source 추가 */
    private addTilePayload(payload: NetworkTilePayload): void {
        assignTileGuids(payload); // 안정적 합성 guid (hover/select 가능, 읽기 전용)
        // 1) 데이터 맵 먼저 병합 (링크 빌드는 nodeMap, 노드 빌드는 linkMap+laneMap 필요)
        for (const node of payload.nodes) this.cachedNodeMap.set(String(node.id), node);
        for (const link of payload.links) this.cachedLinkMap.set(String(link.id), link);

        const addBuffer: Feature[] = [];

        // 2) 링크: 신규 id(0→1)만 빌드 (laneMap 채워야 노드 conn 가능 → 링크 먼저)
        for (const link of payload.links) {
            const id = String(link.id);
            const rc = (this.linkRefCount.get(id) ?? 0) + 1;
            this.linkRefCount.set(id, rc);
            if (rc === 1) {
                const feats = this.buildLinkFeatures(link, this.cachedNodeMap);
                if (feats.length > 0) {
                    this.linkFeaturesMap.set(id, feats);
                    addBuffer.push(...feats);
                }
            }
        }
        // 3) 노드: 신규 id(0→1)만 빌드
        for (const node of payload.nodes) {
            const id = String(node.id);
            const rc = (this.nodeRefCount.get(id) ?? 0) + 1;
            this.nodeRefCount.set(id, rc);
            if (rc === 1) {
                const feats = this.buildNodeFeatures(node, this.cachedLinkMap);
                this.nodeFeaturesMap.set(id, feats);
                addBuffer.push(...feats);
            }
        }

        if (addBuffer.length > 0) {
            this.source.addFeatures(addBuffer);
            try { this.getMapInternal()?.render(); } catch (_) {}
        }
        this.scheduleStoreSync();
    }

    /** 타일 evict → refcount 감소, 마지막 타일(1→0)에서만 피처/캐시 제거 */
    private removeTilePayload(payload: NetworkTilePayload): void {
        const rmBuffer: Feature[] = [];

        for (const link of payload.links) {
            const id = String(link.id);
            const rc = (this.linkRefCount.get(id) ?? 0) - 1;
            if (rc <= 0) {
                this.linkRefCount.delete(id);
                const feats = this.linkFeaturesMap.get(id);
                if (feats) { rmBuffer.push(...feats); this.linkFeaturesMap.delete(id); }
                this.cachedLinkMap.delete(id);
                // laneMap 정리 (linkId_laneIdx 키)
                for (const k of [...this.laneMap.keys()]) {
                    if (k.startsWith(id + "_")) this.laneMap.delete(k);
                }
            } else {
                this.linkRefCount.set(id, rc);
            }
        }
        for (const node of payload.nodes) {
            const id = String(node.id);
            const rc = (this.nodeRefCount.get(id) ?? 0) - 1;
            if (rc <= 0) {
                this.nodeRefCount.delete(id);
                const feats = this.nodeFeaturesMap.get(id);
                if (feats) { rmBuffer.push(...feats); this.nodeFeaturesMap.delete(id); }
                this.cachedNodeMap.delete(id);
            } else {
                this.nodeRefCount.set(id, rc);
            }
        }

        if (rmBuffer.length > 0) {
            for (const f of rmBuffer) {
                if (this.source.hasFeature(f)) this.source.removeFeature(f);
            }
            try { this.getMapInternal()?.render(); } catch (_) {}
        }
        this.scheduleStoreSync();
    }

    /** 링크의 렌더 관련 지오메트리 해시(수정 감지용). 좌표+폭+차선수만으로 충분. */
    private static linkGeoHash(link: any): string {
        const coords = Array.isArray(link?.coordinates)
            ? link.coordinates.map((c: any) => `${c?.lng},${c?.lat}`).join(";") : "";
        return `${coords}|${link?.width ?? ""}|${link?.numLane ?? link?.lanes?.length ?? ""}`;
    }

    /**
     * 편집 델타 추적: currentJsonData 의 링크를 **cachedLinkMap(서버 타일 = 미저장 편집 절대 없음)**
     *   과 비교해 편집 링크 id 를 useNetworkEditStore 에 반영.
     *   - cachedLinkMap 에 없거나 geo 해시가 다른 링크 = 추가/수정(edited).
     *   isChanged 타이밍(setCurrentJsonData→setChange 순서)에 의존하지 않아 첫 편집도 정확히 잡는다.
     *   (삭제는 뷰포트 한계로 이 방식으론 신뢰 어려워 별도 처리 — 여기선 edited 만.)
     */
    private updateEditDeltas(): void {
        if (!NETWORK_TILING.ENABLED) return;
        const store = layerNameToStoreMap[this.LAYER_NAME];
        const links: any[] = (store?.getState() as any)?.currentJsonData?.links ?? [];
        const edited = new Set<string>();
        const storeLinkIds = new Set<string>();
        for (const l of links) {
            if (!l) continue; // null 요소 방어
            const id = String(l.id);
            storeLinkIds.add(id);
            const cached = this.cachedLinkMap.get(id);
            // 서버 타일에 없거나(신규) geo 가 다르면(수정) → 편집됨
            if (!cached || NetworkFeatureLayer.linkGeoHash(cached) !== NetworkFeatureLayer.linkGeoHash(l)) {
                edited.add(id);
            }
        }
        const prev = useNetworkEditStore.getState();
        // 삭제 마스크 정합: store 에 다시 존재하는 링크는 더 이상 삭제 아님 — Ctrl+Z(스냅샷 undo)는
        // 데이터만 되돌리고 마스크를 안 풀어서, 복원된 도로가 MVT 에서 계속 숨겨진 채 남는다.
        // (store 에 없는 id 는 viewport 밖일 수 있으므로 마스크 유지 — 존재 확인된 것만 해제)
        const deleted = new Set([...prev.deletedLinkIds].filter((id) => !storeLinkIds.has(id)));
        // 참조 안정: 내용 동일하면 set 안 함(불필요 재렌더 방지)
        const linksSame = edited.size === prev.editedLinkIds.size &&
            [...edited].every((id) => prev.editedLinkIds.has(id)) &&
            deleted.size === prev.deletedLinkIds.size;
        if (!linksSame) {
            try { useNetworkEditStore.getState().setEdits(edited, deleted); } catch (_) {}
        }

        // 노드 편집 감지 (이동·포트 재배선·커넥션 편집) — 서버 타일 노드와 해시 비교.
        // 미추적 시 타일 동기화(scheduleStoreSync)가 노드 편집을 서버 원본으로 되돌린다.
        // 양쪽에 존재하는 id 만 내용 비교(신규 노드는 동기화가 어차피 prev 보존 경로로 유지).
        const nodes: any[] = (store?.getState() as any)?.currentJsonData?.nodes ?? [];
        const editedNodes = new Set<string>();
        const sigParts: string[] = [];
        for (const n of nodes) {
            if (!n) continue; // null 요소 방어
            const id = String(n.id);
            const cached = this.cachedNodeMap.get(id);
            const hash = NetworkFeatureLayer.nodeEditHash(n);
            if (!cached) { editedNodes.add(id); sigParts.push(id + ':' + hash); continue; } // 신규(그리기/분할) 노드
            if (NetworkFeatureLayer.nodeEditHash(cached) !== hash) {
                editedNodes.add(id);
                sigParts.push(id + ':' + hash);
            }
        }
        // id 집합이 아니라 내용 시그니처로 비교 — 같은 노드를 연속 편집(커넥션 추가→또 추가)해도
        // 집합은 동일하므로, 내용 변화까지 봐야 재빌드(refreshEditedNodeFeatures)가 발동한다.
        const sig = sigParts.sort().join('|');
        if (sig !== this.lastEditedNodesSig) {
            this.lastEditedNodesSig = sig;
            try { useNetworkEditStore.getState().setNodeEdits(editedNodes); } catch (_) {}
        }

        // 노드 삭제 마스크 정합 (링크와 동일 — 스냅샷 undo 복원분 해제)
        const cur = useNetworkEditStore.getState();
        const restoredNodeIds = [...cur.deletedNodeIds].filter((id) =>
            nodes.some((n) => n && String(n.id) === id));
        if (restoredNodeIds.length > 0) {
            try { cur.removeDeletedNodes(restoredNodeIds); } catch (_) { /* noop */ }
        }

        // 편집 델타가 전부 사라졌으면(undo 로 원상 복구) 미저장 플래그 해제 —
        // Ctrl+Z 는 setChange(true) 를 무조건 걸어서, 완전 복구 후에도 "미저장 편집"
        // 배지가 남고 저장 흐름을 혼란시킨다. 서버 상태와 diff 0 = 저장할 것 없음.
        const st: any = store?.getState();
        if (st?.isChanged) {
            const fin = useNetworkEditStore.getState();
            const noDelta = fin.editedLinkIds.size === 0 && fin.deletedLinkIds.size === 0
                && fin.editedNodeIds.size === 0 && fin.deletedNodeIds.size === 0
                && (st.deletedRecords?.length ?? 0) === 0;
            if (noDelta && links.length > 0) {
                try { st.setChange(false); } catch (_) { /* noop */ }
            }
        }
    }

    /** 직전 노드 편집 시그니처 (id:hash 정렬 조인) — 내용 변화 감지용 */
    private lastEditedNodesSig = "";

    /**
     * 편집/삭제된 노드의 OL 피처를 store(currentJsonData) 기준으로 재빌드/제거.
     * 통상 피처는 서버 타일 페이로드로 빌드되므로, 커넥션 편집·노드 이동이 화면에
     * 즉시 반영되려면 편집된 노드만 store 데이터로 다시 그려야 한다.
     * (신규 노드도 editedNodeIds 에 포함되어 그리기 직후 노드·커넥션이 바로 보임)
     */
    private refreshEditedNodeFeatures(edited: Set<string>, deleted: Set<string>): void {
        if (!NETWORK_TILING.ENABLED) return;
        const store = layerNameToStoreMap[this.LAYER_NAME];
        const currentData: any = (store?.getState() as any)?.currentJsonData;
        const nodes: any[] = currentData?.nodes ?? [];
        const nodeById = new Map(nodes.filter(Boolean).map((n: any) => [String(n.id), n]));

        // ⚠️ 실사용 발견(2026-07-30): buildNodeFeatures가 포트를 그리려면 그 포트가 가리키는
        // 링크(port.linkId)의 좌표가 필요한데, 그동안 this.cachedLinkMap(서버 타일 baseline)만
        // 넘겼다 — 방금 그린/분할한 새 링크는 아직 서버 타일에 없어 cachedLinkMap에 없으므로
        // linkMap.get()이 undefined를 반환해 그 포트가 통째로 스킵됐다("아무리 확대해도 새
        // 포트가 안 보임 — 저장 후 재로드하면 서버 타일에 편입돼 보임"으로 재현). scheduleStoreSync가
        // currentJsonData.links를 이미 "서버 타일 ∪ 편집 보존 링크"로 유지해주므로, 그걸
        // cachedLinkMap 위에 덮어써서 신규/수정 링크도 조회되게 한다.
        const linkMap = new Map(this.cachedLinkMap);
        for (const l of (currentData?.links ?? [])) if (l) linkMap.set(String(l.id), l);

        const removeFeats = (id: string) => {
            const feats = this.nodeFeaturesMap.get(id);
            if (feats) {
                for (const f of feats) if (this.source.hasFeature(f)) this.source.removeFeature(f);
                this.nodeFeaturesMap.delete(id);
            }
            this.addedNodeFeatures.delete(id); // extent 게이팅 버킷도 정리 (이중 관리 방지)
        };

        let touched = false;
        for (const id of deleted) {
            if (this.nodeFeaturesMap.has(id)) { removeFeats(id); touched = true; }
        }
        for (const id of edited) {
            const node = nodeById.get(id);
            if (!node) continue;
            removeFeats(id);
            try {
                const feats = this.buildNodeFeatures(node, linkMap);
                this.nodeFeaturesMap.set(id, feats);
                this.source.addFeatures(feats);
                touched = true;
            } catch (_) { /* 좌표 불완전 등 — 스킵 */ }
        }
        if (touched) {
            this.reconcile(); // extent 게이팅 멤버십 재정렬 (직접 add 한 피처 포함)
            try { this.getMapInternal()?.render(); } catch (_) {}
        }
    }

    /** 노드의 편집 감지 해시 — 좌표 + 포트 배선 + 커넥션 목록 (내용 순서 포함) */
    private static nodeEditHash(node: any): string {
        const c = node?.coordinates;
        const coord = c ? `${c.lng},${c.lat}` : "";
        const ports = (node?.ports ?? [])
            .map((p: any) => `${p.type}:${p.linkId}`).join(",");
        const conns = (node?.connections ?? [])
            .map((cn: any) => `${cn.fromLink}_${cn.fromLane}>${cn.toLink}_${cn.toLane}`).join(",");
        return `${coord}|${ports}|${conns}`;
    }

    /** 편집 오버레이 스타일: 편집된 도로를 눈에 띄게(도로 몸체 + 강조 외곽).
     *  진행방향 화살표는 확대(near/detail)했을 때만 — 타일 기반 기존 도로망(MVT)에는
     *  안 붙이고, 지금 편집으로 새로 그리거나 수정한 도로에만 표시한다. */
    private editOverlayStyle(f: Feature, resolution: number): Style[] {
        const ft = f.get("featureType");
        const tier = getNetworkLodTierByResolution(resolution);
        const zoomedIn = tier === 'near' || tier === 'detail';
        if (ft === "links") {
            return [new Style({
                fill: new Fill({ color: "rgba(72,74,80,0.95)" }),               // 도로 몸체
                stroke: new Stroke({ color: "rgba(90,200,255,0.95)", width: 2 }), // 편집 강조(하늘색 외곽)
                zIndex: 120,
            })];
        }
        if (ft === "link-edit") {
            const styles: Style[] = [new Style({ stroke: new Stroke({ color: "rgba(90,200,255,0.9)", width: 1.5 }), zIndex: 121 })];
            if (zoomedIn) {
                const geom = f.getGeometry();
                if (geom instanceof LineString) {
                    styles.push(...NetworkFeatureLayer.buildDirectionArrowStyles(
                        geom.getCoordinates() as [number, number][], 121
                    ));
                }
            }
            return styles;
        }
        return [];
    }

    /** 선택 하이라이트 스타일 (노란 강조). 링크=선, 레인=폴리곤. */
    private selHighlightStyle(f: Feature): Style[] {
        const ft = f.get("featureType");
        if (ft === "cells") {
            return [new Style({ fill: new Fill({ color: "rgba(255,120,0,0.45)" }), stroke: new Stroke({ color: "rgba(255,120,0,1)", width: 2 }), zIndex: 127 })];
        }
        if (ft === "lanes") {
            return [new Style({ fill: new Fill({ color: "rgba(255,200,0,0.35)" }), stroke: new Stroke({ color: "rgba(255,200,0,0.95)", width: 2 }), zIndex: 126 })];
        }
        return [new Style({ stroke: new Stroke({ color: "rgba(255,200,0,0.95)", width: 4 }), zIndex: 126 })];
    }

    /** selectedProps(링크/레인)를 좌표 기반으로 선택 오버레이에 그림. 링크/레인만 대상(노드/신호 등은
     *  기존 OL 피처/3D 엔티티 하이라이트가 담당). */
    private renderSelHighlight(): void {
        if (!this.selHighlightSource) return;
        this.selHighlightSource.clear();
        const props: any = usePropertyStore.getState().selectedProps;
        const ft = props?.featureType;
        try {
            if (ft === "links" && Array.isArray(props.coordinates) && props.coordinates.length >= 2) {
                const pts = props.coordinates.map((c: any) => fromLonLat([c.lng, c.lat]));
                const f = new Feature(new LineString(pts));
                f.set("featureType", "links");
                this.selHighlightSource.addFeature(f);
            } else if (ft === "lanes" || ft === "cells") {
                // 레인/셀: linkRef 로 링크 찾아 레인 폴리곤(오프셋은 렌더와 동일). 셀이면 종방향 구간 클립.
                const linkId = String(props.linkRef ?? "");
                const link: any = this.cachedLinkMap.get(linkId)
                    ?? (layerNameToStoreMap[this.LAYER_NAME]?.getState() as any)?.currentJsonData?.links?.find((l: any) => l && String(l.id) === linkId);
                const laneIdx = Number(props.laneRef ?? props.id ?? 0);
                let ring: number[][] | null = null;
                if (link && ft === "cells") {
                    // 셀: cellIdx / cellCount 로 종방향 [start,end] 비율 → 그 구간만.
                    const lane = link.lanes?.[laneIdx];
                    const n = Math.max(1, lane?.cells?.length || lane?.numCell || Math.ceil((link.length ?? 0) / 100) || 1);
                    const ci = Number(props.cellIdx ?? 0);
                    ring = this.buildLaneRing(link, laneIdx, ci / n, (ci + 1) / n);
                } else if (link) {
                    ring = this.buildLaneRing(link, laneIdx);
                }
                if (ring) {
                    const f = new Feature(new Polygon([ring]));
                    f.set("featureType", ft === "cells" ? "cells" : "lanes");
                    this.selHighlightSource.addFeature(f);
                }
            }
        } catch (_) {}
        try { this.getMapInternal()?.render(); } catch (_) {}
    }

    /** 레인 폴리곤 링(3857) — findNearestLane/렌더와 동일 오프셋 공식.
     *  fracStart/fracEnd(0~1) 지정 시 종방향 그 구간만(셀 하이라이트용). */
    private buildLaneRing(link: any, laneIdx: number, fracStart = 0, fracEnd = 1): number[][] | null {
        const lanes = link?.lanes ?? [];
        const laneCount = lanes.length;
        if (laneCount === 0 || laneIdx < 0 || laneIdx >= laneCount) return null;
        const roadW = link.width ?? 7;
        const laneW = roadW / laneCount;
        // MVT/3D 렌더 정합: 중앙정렬 + 차선0=최좌측. 우측(+) 법선(아래 nx=dy,ny=-dx) 기준 좌측은 음수.
        const off = (laneIdx - (laneCount - 1) / 2) * laneW;
        const half = laneW / 2;
        let pts: number[][] = (link.coordinates ?? []).map((c: any) => fromLonLat([c.lng, c.lat]));
        if (pts.length < 2) return null;
        // 종방향 구간 클립: 누적거리 비율 [fracStart, fracEnd] 에 해당하는 중심선 부분경로 추출.
        if (fracStart > 0 || fracEnd < 1) {
            const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]![0]! - pts[i - 1]![0]!, pts[i]![1]! - pts[i - 1]![1]!));
            const total = cum[cum.length - 1]! || 1;
            const dS = fracStart * total, dE = fracEnd * total;
            const at = (d: number): number[] => {
                for (let i = 1; i < cum.length; i++) if (d <= cum[i]!) { const t = (d - cum[i - 1]!) / ((cum[i]! - cum[i - 1]!) || 1); return [pts[i - 1]![0]! + (pts[i]![0]! - pts[i - 1]![0]!) * t, pts[i - 1]![1]! + (pts[i]![1]! - pts[i - 1]![1]!) * t]; }
                return pts[pts.length - 1]!;
            };
            const sub: number[][] = [at(dS)];
            for (let i = 0; i < pts.length; i++) if (cum[i]! > dS && cum[i]! < dE) sub.push(pts[i]!);
            sub.push(at(dE));
            pts = sub;
            if (pts.length < 2) return null;
        }
        const left: number[][] = [], right: number[][] = [];
        for (let i = 0; i < pts.length; i++) {
            const prev = pts[Math.max(0, i - 1)]!;
            const next = pts[Math.min(pts.length - 1, i + 1)]!;
            const sdx = next[0]! - prev[0]!, sdy = next[1]! - prev[1]!;
            const sl = Math.hypot(sdx, sdy) || 1;
            const nx = sdy / sl, ny = -sdx / sl; // 우측 법선(3D right 정합)
            const cx = pts[i]![0]! + nx * off, cy = pts[i]![1]! + ny * off;
            left.push([cx + nx * half, cy + ny * half]);
            right.push([cx - nx * half, cy - ny * half]);
        }
        return [...left, ...right.reverse(), left[0]!];
    }

    /** editedLinkIds 링크를 currentJsonData 에서 뽑아 오버레이 소스에 (재)렌더.
     *  ⚠️ buildLinkFeatures 는 this.laneMap/nodeCoordMap 를 변경(부작용)하므로 쓰지 않는다.
     *     여기선 링크 좌표에서 직접 중심선 LineString + 버퍼 폴리곤만 만든다(부작용 없음). */
    private renderEditOverlay(): void {
        if (!this.editOverlaySource) return;
        this.editOverlaySource.clear();
        const editedIds = useNetworkEditStore.getState().editedLinkIds;
        if (editedIds.size === 0) { try { this.getMapInternal()?.render(); } catch (_) {} return; }
        const store = layerNameToStoreMap[this.LAYER_NAME];
        const net: any = store?.getState()?.currentJsonData;
        const links: any[] = net?.links ?? [];
        const buf: Feature[] = [];
        for (const link of links) {
            if (!editedIds.has(String(link.id))) continue;
            const coords = link?.coordinates;
            if (!Array.isArray(coords) || coords.length < 2) continue;
            const pts: [number, number][] = coords.map((c: any) => fromLonLat([c.lng, c.lat]) as [number, number]);
            // 중심선
            const line = new Feature(new LineString(pts));
            line.setProperties({ featureType: "link-edit", linkRef: link.id });
            buf.push(line);
            // 버퍼 폴리곤(도로 몸체) — 세그먼트별 법선 오프셋(부작용 없는 로컬 계산)
            const half = (link.width ?? 3) / 2;
            const left: number[][] = [], right: number[][] = [];
            for (let i = 0; i < pts.length; i++) {
                const prev = pts[Math.max(0, i - 1)]!;
                const next = pts[Math.min(pts.length - 1, i + 1)]!;
                const sdx = next[0] - prev[0], sdy = next[1] - prev[1];
                const sl = Math.hypot(sdx, sdy) || 1;
                const nx = -sdy / sl, ny = sdx / sl;
                const p = pts[i]!;
                left.push([p[0] + nx * half, p[1] + ny * half]);
                right.push([p[0] - nx * half, p[1] - ny * half]);
            }
            const ring = [...left, ...right.reverse(), left[0]!];
            const poly = new Feature(new Polygon([ring]));
            poly.setProperties({ featureType: "links", linkRef: link.id });
            buf.push(poly);
        }
        if (buf.length > 0) this.editOverlaySource.addFeatures(buf);
        try { this.getMapInternal()?.render(); } catch (_) {}
    }

    /**
     * 편집이 정리됨(저장 또는 폐기, isChanged true→false) → 서버가 최신 데이터를 가지므로:
     *   1) 편집 델타/오버레이 초기화, 2) MVT 소스 새로고침(타일 재fetch, 저장한 도로 서버 렌더 반영),
     *   3) viewport 타일 캐시 비우고 재fetch(cachedLinkMap 서버 최신화).
     */
    private onEditsCleared(): void {
        try { useNetworkEditStore.getState().clear(); } catch (_) {}
        this.editOverlaySource?.clear();
        // MVT 새로고침: OL VectorTileSource.refresh() 가 캐시 비우고 재fetch.
        try { (this.mvtLayer?.getSource() as any)?.refresh?.(); } catch (_) {}
        // viewport 타일 재fetch → cachedLinkMap 서버 최신(저장 반영). 편집 delta 도 자연 소멸.
        try {
            this.tileManager?.clear();
            const map = this.getMapInternal();
            if (map) this.updateTiles(map);
        } catch (_) {}
        try { this.getMapInternal()?.render(); } catch (_) {}
    }

    /**
     * 타일 모드에서 viewport 네트워크(cachedLinkMap/cachedNodeMap)를 store.currentJsonData 로 동기화.
     * 의존 레이어(신호·버스·철도·히트맵 등 9개)가 코드 변경 없이 viewport 네트워크를 참조 →
     * store 메모리도 viewport 규모로 제한. debounce 로 다중 타일 로드 후 1회만 set.
     */
    private scheduleStoreSync(): void {
        if (!NETWORK_TILING.ENABLED) return;
        if (this.storeSyncTimer) return;
        this.storeSyncTimer = setTimeout(() => {
            this.storeSyncTimer = null;
            const store = layerNameToStoreMap[this.LAYER_NAME];
            // 활성 그리기/커넥션/배치 중에는 완전 동결 — 진행 중 편집 상태가 store 에 있어 덮으면 깨진다.
            const draw = useNetworkDrawStore.getState();
            if (draw.isActive || draw.isConnectionActive || draw.placementMode !== 'none') return;

            // 그 외(선택 모드·idle)에는 viewport 타일로 갱신하되 **미저장 편집 링크는 보존 병합**.
            //   (전면 동결하면 팬/줌 후 새 지역 링크가 store 에 없어 선택 불가. 전면 덮으면 편집 손실.)
            const prev: any = store.getState().currentJsonData ?? {};
            const edit = useNetworkEditStore.getState();
            const editedIds = edit.editedLinkIds, deletedIds = edit.deletedLinkIds;
            const editedNodeIds = edit.editedNodeIds, deletedNodeIds = edit.deletedNodeIds;

            // viewport 타일 링크(서버 최신) + 편집된 링크(prev 에서 보존). 삭제된 링크는 제외.
            const linkById = new Map<string, any>();
            for (const l of this.cachedLinkMap.values()) if (l) linkById.set(String(l.id), l);
            for (const l of (prev.links ?? [])) {          // 편집(추가/수정) 링크는 prev 값으로 덮어씀(보존)
                if (l && editedIds.has(String(l.id))) linkById.set(String(l.id), l);
            }
            for (const id of deletedIds) linkById.delete(id); // 삭제 링크 제외

            const nodeById = new Map<string, any>();
            for (const n of this.cachedNodeMap.values()) if (n) nodeById.set(String(n.id), n);
            // 편집된 노드(이동·포트 재배선·커넥션 편집)는 prev 값으로 덮어씀(보존) —
            // 없으면 다음 동기화가 서버 타일 원본으로 되돌려 편집 유실
            for (const n of (prev.nodes ?? [])) {
                if (n && editedNodeIds.has(String(n.id))) nodeById.set(String(n.id), n);
            }
            // 편집 링크가 참조하는 노드는 prev 에서 보존(신규 노드가 타일에 없을 수 있음)
            if (editedIds.size > 0) {
                for (const n of (prev.nodes ?? [])) if (n && !nodeById.has(String(n.id))) nodeById.set(String(n.id), n);
            }
            for (const id of deletedNodeIds) nodeById.delete(id); // 삭제 노드 제외 (되살아남 방지)

            const next = { ...prev, links: [...linkById.values()], nodes: [...nodeById.values()] };
            // setCurrentJsonData 는 구독 트리거 → 의존 레이어 재로드 (자기 load()는 타일모드 가드로 no-op)
            store.getState().setCurrentJsonData(next as Network);
        }, 150);
    }

    /**
     * 현재 화면 extent + LOD tier 기준으로 source 멤버십을 동기화.
     * - 빌드된 피처 캐시(linkFeaturesMap/nodeFeaturesMap)는 그대로 두고,
     *   "화면 안 + 현재 tier에서 보이는" 피처만 source에 add/remove.
     * - moveend(정착)·visibility 변경·fullBuild 직후에만 호출 (매 프레임 아님).
     */
    private reconcile(): void {
        if (!NETWORK_EXTENT_GATING.ENABLED) return;
        if (!this.getVisible()) return;

        const map = this.getMapInternal();
        const size = map?.getSize();
        const view = map?.getView();
        const resolution = view?.getResolution();
        if (!map || !size || !view || resolution == null) return;

        const tier = getNetworkLodTierByResolution(resolution);

        // 뷰 extent를 폭/높이의 일정 비율만큼 확장 (팬 시 빈 영역 방지)
        const raw = view.calculateExtent(size);
        const margin = Math.max(getWidth(raw), getHeight(raw)) * NETWORK_EXTENT_GATING.RENDER_BUFFER_RATIO;
        const ext = buffer(raw, margin);

        const tierChanged = tier !== this.lastTier;

        // 링크 그룹 (OL addFeatures/removeFeatures는 내부 배치 처리됨)
        for (const [linkId, features] of this.linkFeaturesMap) {
            const lext = this.linkExtentMap.get(linkId);
            const inView = lext ? intersects(ext, lext) : true;
            const desired = inView
                ? features.filter(f => isNetworkFeatureVisibleAtTier(f.get("featureType"), tier))
                : [];
            this.syncGroup(this.addedLinkFeatures, linkId, desired, tierChanged);
        }

        // 노드 그룹
        for (const [nodeId, features] of this.nodeFeaturesMap) {
            const coord = this.nodeCoordMap.get(nodeId);
            const inView = coord ? containsCoordinate(ext, coord) : true;
            const desired = inView
                ? features.filter(f => isNetworkFeatureVisibleAtTier(f.get("featureType"), tier))
                : [];
            this.syncGroup(this.addedNodeFeatures, nodeId, desired, tierChanged);
        }

        this.lastTier = tier;
    }

    /** 한 그룹(링크/노드)의 source 멤버십을 desired와 일치시킨다 (피처 단위 set-diff). */
    private syncGroup(
        bucket: Map<string, Feature[]>,
        id: string,
        desired: Feature[],
        forceResync: boolean,
    ): void {
        const cur = bucket.get(id) ?? [];

        if (desired.length === 0) {
            if (cur.length > 0) {
                this.source.removeFeatures(cur);
                bucket.delete(id);
            }
            return;
        }

        // tier가 바뀌지 않았고 멤버십도 동일하면(개수+참조) 스킵 (대부분의 그룹은 변화 없음)
        if (!forceResync && cur.length === desired.length) {
            let same = true;
            for (let i = 0; i < cur.length; i++) {
                if (cur[i] !== desired[i]) { same = false; break; }
            }
            if (same) return;
        }

        const curSet = new Set(cur);
        const desSet = new Set(desired);
        const toRemove = cur.filter(f => !desSet.has(f));
        const toAdd = desired.filter(f => !curSet.has(f));
        if (toRemove.length > 0) this.source.removeFeatures(toRemove);
        if (toAdd.length > 0) this.source.addFeatures(toAdd);
        bucket.set(id, desired);
    }

    /** 링크/노드 공간 인덱스를 캐시 피처로부터 재구성 (fullBuild 후). */
    private rebuildSpatialIndex(): void {
        this.linkExtentMap.clear();
        this.nodeCoordMap.clear();
        for (const [linkId, features] of this.linkFeaturesMap) this.indexLink(linkId, features);
        for (const [nodeId, features] of this.nodeFeaturesMap) this.indexNode(nodeId, features);
    }

    /** 링크 중심선 좌표(OL 투영 단위 ≈ m)를 따라 ARROW_INTERVAL_M 간격으로 진행방향 화살표
     *  삼각형 Style을 생성한다. connections 화살표(끝점 1개)와 달리 링크 전체 길이에 걸쳐
     *  여러 개 배치 — 3D(NetworkDataSourceLayer.buildArrowInstances)와 동일한 사고방식·간격.
     *  링크가 간격보다 짧으면 중앙에 1개만. */
    private static buildDirectionArrowStyles(coords: [number, number][], zIndex: number): Style[] {
        if (coords.length < 2) return [];
        const segLens: number[] = [];
        let total = 0;
        for (let i = 1; i < coords.length; i++) {
            const d = Math.hypot(coords[i]![0] - coords[i - 1]![0], coords[i]![1] - coords[i - 1]![1]);
            segLens.push(d);
            total += d;
        }
        if (total < 1) return [];

        const interval = NetworkFeatureLayer.ARROW_INTERVAL_M;
        const arrowLen = 3;
        const halfWidth = 0.9;
        const marks: number[] = total < interval
            ? [total / 2]
            : (() => {
                const out: number[] = [];
                for (let d = interval / 2; d < total; d += interval) out.push(d);
                return out;
            })();

        const styles: Style[] = [];
        for (const mark of marks) {
            let acc = 0;
            let segIdx = 0;
            while (segIdx < segLens.length - 1 && acc + segLens[segIdx]! < mark) {
                acc += segLens[segIdx]!;
                segIdx++;
            }
            const segLen = segLens[segIdx] ?? 0;
            if (segLen < 1e-6) continue;
            const p0 = coords[segIdx]!;
            const p1 = coords[segIdx + 1]!;
            const frac = Math.min(1, Math.max(0, (mark - acc) / segLen));
            const cx = p0[0] + (p1[0] - p0[0]) * frac;
            const cy = p0[1] + (p1[1] - p0[1]) * frac;

            const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
            const dlen = Math.hypot(dx, dy);
            if (dlen < 1e-6) continue;
            const ux = dx / dlen, uy = dy / dlen;
            const nx = -uy, ny = ux;

            const tip: [number, number]      = [cx + ux * arrowLen / 2, cy + uy * arrowLen / 2];
            const backCx = cx - ux * arrowLen / 2, backCy = cy - uy * arrowLen / 2;
            const backLeft: [number, number]  = [backCx + nx * halfWidth, backCy + ny * halfWidth];
            const backRight: [number, number] = [backCx - nx * halfWidth, backCy - ny * halfWidth];

            styles.push(new Style({
                geometry: new Polygon([[tip, backLeft, backRight, tip]]),
                fill: new Fill({ color: "rgba(255,255,255,0.75)" }),
                zIndex,
            }));
        }
        return styles;
    }

    public styleFunction(feature: FeatureLike, resolution: number): Style[] {
        const props: any = feature.getProperties() ?? {};
        const geom = feature.getGeometry();
        const styles: Style[] = [];

        const featureType = props.featureType ?? "";

        // MVT 모드: 도로/차선/중심선은 MVT(NetworkMvtLayer)가 그림. NetworkFeatureLayer 벡터는
        //   detail(충분히 확대)에서 편집요소(노드/커넥션/포트)만 그린다. detail 미만은 전부 MVT 양보.
        if (NETWORK_TILING.USE_MVT_2D) {
            if (getNetworkLodTierByResolution(resolution) !== 'detail') return [];
            if (featureType !== 'nodes' && featureType !== 'connections' && featureType !== 'ports') return [];
            // 노드/커넥션/포트만 아래 정상 렌더 (links/lanes/link-edit/cells/segments는 MVT 담당)
        }

        // LOD 필터링: 현재 tier에서 표시 대상이 아닌 피처 타입은 렌더링 생략 (공통 tier 함수 사용)
        const tier = getNetworkLodTierByResolution(resolution);
        if (!isNetworkFeatureVisibleAtTier(featureType, tier)) return [];

        const zIndex = this.zIndexMap[featureType] ?? 0;
        const res = Math.max(resolution, NetworkFeatureLayer.EPS);

        // LINK (polygon)
        if (geom instanceof Polygon && featureType === "links") {
            styles.push(new Style({
                fill: new Fill({ color: "rgba(72,74,80,0.92)" }),
                zIndex
            }));
        }

        // LINK-EDIT (center line)
        if (geom instanceof LineString && featureType === "link-edit") {
            // overview/mid: 링크 폴리곤이 안 보이거나 sub-pixel이라 중심선이 사실상 유일한 도로 표현 →
            //   최소 가시 픽셀 굵기 + 차선수 비례로 "도로망 지도"처럼 보이게 한다.
            // near/detail: 폴리곤이 도로 본체를 그리므로 중심선은 기존 편집용 얇은 빨강선.
            if (tier === 'overview' || tier === 'mid') {
                // MVT 레이어가 이 구간 도로망을 담당하면 중복 렌더 생략 (양보)
                if (NETWORK_TILING.USE_MVT_2D && this.mvtLayer) return [];
                const laneCount = props.lanes?.length ?? 1;
                // 간선(차선 多)일수록 굵게, 최소 0.8px ~ 최대 3px 보장
                const width = Math.max(0.8, Math.min(3, 0.6 + laneCount * 0.3));
                styles.push(new Style({
                    stroke: new Stroke({ color: "rgba(236,238,245,0.9)", width }),
                    zIndex
                }));
            } else {
                styles.push(new Style({
                    stroke: new Stroke({ color: "rgba(200,0,0,0.75)", width: Math.min(2, 0.3 / res) }),
                    zIndex
                }));
            }
        }

        // LANE (polygon)
        if (geom instanceof Polygon && featureType === "lanes") {
            const laneColor = (props.laneRef ?? 0) % 2 === 0 ? "rgba(62,64,70,1.0)" : "rgba(84,86,94,1.0)";
            styles.push(new Style({
                fill: new Fill({ color: laneColor }),
                stroke: new Stroke({ color: "rgba(30,30,35,0.78)", width: Math.min(2, 0.5 / res) }),
                zIndex
            }));
        }

        // LANE-EDIT (center line)
        if (geom instanceof LineString && featureType === "lane-edit") {
            styles.push(new Style({
                zIndex
            }));
        }

        // CELL (polygon) — 빨강 분할 폴리곤
        if (geom instanceof Polygon && featureType === "cells") {
            styles.push(new Style({
                fill: new Fill({ color: "rgba(200,0,0,0.75)" }),
                stroke: new Stroke({ color: "rgba(200,0,0,0.75)", width: Math.min(2, 0.3 / res) }),
                zIndex
            }));
        }

        // SEGMENT (polygon)
        if (geom instanceof Polygon && featureType === "segments") {
            const isBlocked = !!props.block;
            const fillColor = isBlocked ? "rgba(255,255,0,0.8)" : "rgba(0,0,255,0.5)";
            const strokeColor = isBlocked ? "rgba(128,128,0,0.9)" : "rgba(0,0,128,0.9)";
            styles.push(new Style({
                fill: new Fill({ color: fillColor }),
                stroke: new Stroke({ color: strokeColor, width: Math.min(2, 0.3 / res) }),
                zIndex
            }));
        }

        // CONNECTIONS (polyline + arrow head)
        if (geom instanceof LineString && featureType === "connections") {
            const color = "#ffffff";
            styles.push(new Style({
                stroke: new Stroke({ color, width: Math.min(3, 0.5 / res) }),
                zIndex
            }));

            const coordinates = geom.getCoordinates();
            if (coordinates.length >= 2) {
                const end = coordinates[coordinates.length - 1];
                const start = coordinates[coordinates.length - 2];

                const dx = end[0] - start[0];
                const dy = end[1] - start[1];
                const len = Math.hypot(dx, dy);
                if (len > 0) {
                    const ux = dx / len;
                    const uy = dy / len;
                    const nx = -uy;
                    const ny = ux;

                    const arrowLength = 1.8;
                    const baseWidth = 0.8;

                    const baseCenter: [number, number] = [
                        end[0] - ux * arrowLength,
                        end[1] - uy * arrowLength,
                    ];

                    const baseLeft: [number, number] = [
                        baseCenter[0] + nx * baseWidth / 2,
                        baseCenter[1] + ny * baseWidth / 2,
                    ];
                    const baseRight: [number, number] = [
                        baseCenter[0] - nx * baseWidth / 2,
                        baseCenter[1] - ny * baseWidth / 2,
                    ];

                    styles.push(new Style({
                        geometry: new Polygon([[baseLeft, baseRight, end, baseLeft]]),
                        fill: new Fill({ color }),
                        stroke: new Stroke({ color, width: 0.1 }),
                    }));
                }
            }
        }

        if (geom instanceof Point && featureType === "nodes") {
            const radius = NetworkFeatureLayer.NODE_RADIUS_SCALE / res;  // 무제한 확대
            styles.push(new Style({
                image: new CircleStyle({
                    radius,
                    fill: new Fill({ color: "rgba(255, 255, 0, 1)" }),
                    stroke: new Stroke({ color: "rgb(128,128,0)", width: 0.1 }),
                }),
                zIndex
            }));
        }
        if (geom instanceof Point && featureType === "ports") {
            const portType = props.type;
            const r = NetworkFeatureLayer.PORT_ICON_SCALE / res;

            if (portType === "out") {
                styles.push(new Style({
                    image: new CircleStyle({
                        radius: r * 0.75,
                        fill: new Fill({ color: "rgba(0,200,200,0.5)" }),
                    }),
                    zIndex: zIndex + 1
                }));
            } else if (portType === "in") {
                styles.push(new Style({
                    image: new CircleStyle({
                        radius: r,
                        fill: new Fill({ color: "rgba(200,0,200,0.5)" }),
                    }),
                    zIndex: zIndex
                }));
            }
        }
        // 정지선 (in 포트의 수직선)
        if (geom instanceof LineString && featureType === "ports") {
            styles.push(new Style({
                stroke: new Stroke({ color: "rgba(255,255,255,0.9)", width: Math.max(1, 2 / res) }),
                zIndex: zIndex + 1,
            }));
        }

        return styles;
    }

    private generateQuadraticBezierCurve(
        from: Coordinate,
        controlPoint: Coordinate,
        to: Coordinate,
        numberOfPoints: number = 15,
        pullScale: number = 0.4
    ): Coordinate[] {
        const basePoint: Coordinate = [
            (from[0] + to[0]) / 2,
            (from[1] + to[1]) / 2,
        ];

        const effectiveControlPoint: Coordinate = [
            basePoint[0] + (controlPoint[0] - basePoint[0]) * pullScale,
            basePoint[1] + (controlPoint[1] - basePoint[1]) * pullScale,
        ];

        const curvePoints: Coordinate[] = [];
        for (let i = 0; i <= numberOfPoints; i++) {
            const t = i / numberOfPoints;
            const tInv = 1 - t;
            const x = (tInv ** 2) * from[0] + 2 * tInv * t * effectiveControlPoint[0] + (t ** 2) * to[0];
            const y = (tInv ** 2) * from[1] + 2 * tInv * t * effectiveControlPoint[1] + (t ** 2) * to[1];
            curvePoints.push([x, y]);
        }
        return curvePoints;
    }

    private createRectangleAlongLane(
        source: Coordinate,
        target: Coordinate,
        offset: number,
        length: number,
        width: number
    ): Coordinate[] | null {
        const dx = target[0] - source[0];
        const dy = target[1] - source[1];
        const L = Math.hypot(dx, dy);
        if (L === 0) return null;

        const ux = dx / L;
        const uy = dy / L;
        const nx = -uy;
        const ny = ux;

        const startDist = Math.max(0, Math.min(L, offset));
        const endDist = Math.max(startDist, Math.min(L, offset + Math.max(0, length)));
        if (endDist <= startDist) return null;

        const halfW = width / 2;

        const sx = source[0] + ux * startDist;
        const sy = source[1] + uy * startDist;
        const ex = source[0] + ux * endDist;
        const ey = source[1] + uy * endDist;

        const leftStart: Coordinate = [sx + nx * halfW, sy + ny * halfW];
        const leftEnd: Coordinate = [ex + nx * halfW, ey + ny * halfW];
        const rightEnd: Coordinate = [ex - nx * halfW, ey - ny * halfW];
        const rightStart: Coordinate = [sx - nx * halfW, sy - ny * halfW];

        return [leftStart, leftEnd, rightEnd, rightStart, leftStart];
    }

    private createRectanglesTiledAlongLane(
        source: Coordinate,
        target: Coordinate,
        offset: number,
        unitLength: number,
        width: number
    ): Coordinate[][] {
        const rings: Coordinate[][] = [];

        const dx = target[0] - source[0];
        const dy = target[1] - source[1];
        const L = Math.hypot(dx, dy);
        if (L === 0) return rings;

        const startDist = Math.max(0, Math.min(L, offset));
        const remain = Math.max(0, L - startDist);
        if (remain === 0) return rings;

        const step = Math.max(0, unitLength);
        if (step === 0) return rings;

        const nFull = Math.floor(remain / step);
        const rem = remain - nFull * step;

        let curStart = startDist;

        for (let i = 0; i < nFull; i++) {
            const ring = this.createRectangleAlongLane(source, target, curStart, step, width);
            if (ring) rings.push(ring);
            curStart += step;
        }

        if (rem > 1e-9) {
            const ring = this.createRectangleAlongLane(source, target, curStart, rem, width);
            if (ring) rings.push(ring);
        }

        return rings;
    }

    public async load(): Promise<void> {
        // 타일 모드: store 기반 전체 빌드를 하지 않는다 (타일 매니저가 viewport 분만 빌드).
        if (NETWORK_TILING.ENABLED) return;
        const store = layerNameToStoreMap[this.LAYER_NAME];
        try {
            const network: Network | undefined = store.getState().currentJsonData;
            if (!network) return;

            const doFull = !this.prevNetwork || this.isFullReplace(this.prevNetwork, network);
            if (doFull) {
                this.fullBuild(network);
            } else {
                this.incrementalUpdate(this.prevNetwork!, network);
            }
            this.prevNetwork = network;
        } catch (e) {
            console.error("NetworkLayer.load 에러:", e);
        }
    }

    private isFullReplace(prev: Network, next: Network): boolean {
        // importEpoch 증가 → 파일 임포트 → 전체 재빌드
        const store = layerNameToStoreMap[this.LAYER_NAME];
        const currentEpoch = store.getState().importEpoch;
        if (currentEpoch > this.lastImportEpoch) {
            this.lastImportEpoch = currentEpoch;
            return true;
        }
        if (!prev.links?.length || !next.links?.length) return true;

        // 링크 수가 같으면서 어느 링크라도 참조가 달라진 경우 → 기존 링크 수정 (형상 편집 등) → 전체 재빌드
        if (next.links.length === prev.links.length) {
            return next.links.some((l, i) => l !== prev.links[i]);
        }

        // Fast path: append-only (도로 그리기) — 첫 링크 참조 동일이면 안전한 증분
        if (next.links.length > prev.links.length && next.links[0] === prev.links[0]) {
            return false;
        }

        // Slow path: 공통 ID 없으면 전체 교체 (다른 파일 로드)
        const hasCommon = next.links.some(l => l && this.cachedLinkMap.has(String(l.id)));
        return !hasCommon;
    }

    private fullBuild(network: Network): void {
        this.linkFeaturesMap.clear();
        this.nodeFeaturesMap.clear();
        this.laneMap.clear();

        const nodes = (network.nodes ?? []).filter(Boolean); // null 요소 방어
        const links = (network.links ?? []).filter(Boolean);
        // 캐시 Map 초기화 (이후 incrementalUpdate에서 증분 갱신)
        this.cachedNodeMap = new Map(nodes.map(n => [String(n.id), n]));
        this.cachedLinkMap = new Map(links.map(l => [String(l.id), l]));
        const nodeMap = this.cachedNodeMap;
        const linkMap = this.cachedLinkMap;
        const featureBuffer: Feature[] = [];

        // MVT 모드: 도로/차선/중심선/셀/세그먼트는 MVT가 그리므로(styleFunction이 return []) 링크
        //   feature를 만들지 않는다 → 41k링크 × 차선/셀 feature 빌드 제거(초기 로딩 대폭 경량화).
        //   노드/커넥션/포트(편집요소)만 빌드. cachedLinkMap(데이터)은 유지해 커넥션이 링크 좌표 참조 가능.
        if (!NETWORK_TILING.USE_MVT_2D) {
            for (const link of links) {
                const features = this.buildLinkFeatures(link, nodeMap);
                if (features.length > 0) {
                    this.linkFeaturesMap.set(String(link.id), features);
                    featureBuffer.push(...features);
                }
            }
        }
        for (const node of nodes) {
            const features = this.buildNodeFeatures(node, linkMap);
            this.nodeFeaturesMap.set(String(node.id), features);
            featureBuffer.push(...features);
        }

        // source/게이팅 상태 완전 초기화 (수정·삭제 후 stale 피처가 남지 않도록)
        this.source.clear();
        this.addedLinkFeatures.clear();
        this.addedNodeFeatures.clear();
        this.lastTier = null;

        if (!NETWORK_EXTENT_GATING.ENABLED) {
            // 게이팅 비활성: 기존 동작 그대로 전체 추가
            this.source.addFeatures(featureBuffer);
            return;
        }

        // 게이팅 활성: 공간 인덱스 재구성 후 현재 화면분만 reconcile로 추가
        this.rebuildSpatialIndex();
        this.reconcile();
    }

    private incrementalUpdate(prev: Network, next: Network): void {
        // ── 핵심 최적화: O(N) Map 5개 재생성 대신 참조 동등성 스캔 ──
        // finishSegment()는 links/nodes 배열 끝에만 추가하고, 기존 원소는 같은 참조를 유지한다.

        // 1. 순수 append 검증: 기존 마지막 링크/노드 참조가 각각 동일해야 한다
        //    (split/merge는 filter로 중간 제거 후 재구성 → 마지막 원소가 달라지거나, 길이는
        //    같거나 늘었어도 중간 원소가 빠지며 뒤쪽 인덱스가 전부 밀린다).
        //    ⚠️ 실사용 발견: 노드 쪽은 이 마지막-원소 검증이 누락돼 있었다 — 중복 노드 병합
        //    (mergeNodesInNetwork)처럼 노드 하나가 배열 중간에서 제거+재구성되면 nodes.length
        //    조건은 우연히 통과할 수 있는데, 그러면 아래 인덱스 기반 diff가 밀린 인덱스를
        //    엉뚱한 노드로 오인해 newPorts = nextNode.ports.slice(prevNode.ports.length)가
        //    잘못된 길이로 잘려 새로 생긴 포트가 조용히 렌더링 누락됐다("아무리 확대해도
        //    포트가 안 보임 — 저장 후 재로드(fullBuild)하면 보임"으로 재현).
        const prevLastLinkIdx = prev.links.length - 1;
        const prevLastNodeIdx = prev.nodes.length - 1;
        const isPureAppend =
            next.links.length >= prev.links.length &&
            next.nodes.length >= prev.nodes.length &&
            prevLastLinkIdx >= 0 &&
            next.links[prevLastLinkIdx] === prev.links[prevLastLinkIdx] &&
            prevLastNodeIdx >= 0 &&
            next.nodes[prevLastNodeIdx] === prev.nodes[prevLastNodeIdx];

        if (!isPureAppend) {
            this.fullBuild(next);
            return;
        }

        // 2. 참조 스캔으로 변경된 기존 노드 인덱스 수집 (Map 생성 없이 O(N) 스캔)
        const changedNodeIndices: number[] = [];
        const minNodeLen = Math.min(prev.nodes.length, next.nodes.length);
        for (let i = 0; i < minNodeLen; i++) {
            if (prev.nodes[i] !== next.nodes[i]) changedNodeIndices.push(i);
        }

        // 3. 끝에 append된 신규 항목
        const newLinks = next.links.length > prev.links.length
            ? next.links.slice(prev.links.length) : [];
        const newNodes = next.nodes.length > prev.nodes.length
            ? next.nodes.slice(prev.nodes.length) : [];

        if (changedNodeIndices.length === 0 && newLinks.length === 0 && newNodes.length === 0) return;

        // 4. 캐시 Map 증분 갱신 (전체 재생성 없이 변경분만, null 요소 방어)
        for (const i of changedNodeIndices) {
            const node = next.nodes[i];
            if (node) this.cachedNodeMap.set(String(node.id), node);
        }
        for (const node of newNodes) {
            if (node) this.cachedNodeMap.set(String(node.id), node);
        }
        for (const link of newLinks) {
            if (link) this.cachedLinkMap.set(String(link.id), link);
        }

        // 5. 신규 링크 피처 추가 (먼저: laneMap이 채워져야 노드 conn 빌드 가능)
        const addBuffer: Feature[] = [];
        for (const link of newLinks) {
            if (!link) continue; // null 요소 방어
            const features = this.buildLinkFeatures(link, this.cachedNodeMap);
            if (features.length > 0) {
                const id = String(link.id);
                this.linkFeaturesMap.set(id, features);
                this.indexLink(id, features); // 신규 링크 공간 인덱스 등록
                addBuffer.push(...features);
            }
        }

        // 6. 변경된 노드: 기존 피처 제거 없이 delta port/conn만 append (O(1))
        //    finishSegment는 ports/connections를 항상 끝에 추가(append)하므로
        //    slice(prevLen)으로 신규 항목만 골라 피처를 추가한다.
        for (const i of changedNodeIndices) {
            const prevNode = prev.nodes[i];
            const nextNode = next.nodes[i];
            if (!prevNode || !nextNode) continue; // null 요소 방어
            const id = String(nextNode.id);
            const existingFeatures = this.nodeFeaturesMap.get(id) ?? [];

            const newPorts = nextNode.ports.slice(prevNode.ports.length);
            for (const port of newPorts) {
                const link = this.cachedLinkMap.get(String(port.linkId));
                if (!link) continue;

                if (port.type === 'out' && link.coordinates?.[0]) {
                    const portPos = fromLonLat([link.coordinates[0].lng, link.coordinates[0].lat]);
                    const f = new Feature({ ...port, geometry: new Point(portPos), featureType: 'ports' });
                    existingFeatures.push(f); addBuffer.push(f);

                } else if (port.type === 'in' && link.coordinates?.length >= 2) {
                    const coords = link.coordinates;
                    const p1 = fromLonLat([coords[coords.length - 2].lng, coords[coords.length - 2].lat]);
                    const p2 = fromLonLat([coords[coords.length - 1].lng, coords[coords.length - 1].lat]);
                    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
                    const len = Math.sqrt(dx * dx + dy * dy);
                    if (len > 0) {
                        const px = -dy / len, py = dx / len;
                        const halfW = (link.width ?? 7) / 2;
                        const stopLine = new LineString([
                            [p2[0] - px * halfW, p2[1] - py * halfW],
                            [p2[0] + px * halfW, p2[1] + py * halfW],
                        ]);
                        const sf = new Feature({ ...port, geometry: stopLine, featureType: 'ports' });
                        existingFeatures.push(sf); addBuffer.push(sf);
                    }
                    const last = coords[coords.length - 1];
                    const pf = new Feature({ ...port, geometry: new Point(fromLonLat([last.lng, last.lat])), featureType: 'ports' });
                    existingFeatures.push(pf); addBuffer.push(pf);
                }
            }

            const newConns = nextNode.connections.slice(prevNode.connections.length);
            const nodePt = fromLonLat([nextNode.coordinates.lng, nextNode.coordinates.lat]);
            for (const conn of newConns) {
                const isStraight = normalizeTurning(conn.turning) === 'Straight';
                // 3점 이상 = 내부링크 경로 폴리라인 — 회전 커넥션(교통섬 순환 등 실측 경로)만
                // 그대로 사용. 직진은 원본에 중간 경유점이 있어도 여러 차선이 같은 경유점으로
                // 합성돼(KTDB 내부링크 생성 시 차선별 분리 없이 공유) 교차로 중앙에서 겹쳐
                // 보이는 인공물이 되므로, 직진은 항상 시작~끝 2점 직선으로 그린다(실사용 발견 —
                // 4개 차선의 turning=S 커넥션이 전부 동일한 중간 좌표 2점을 거치는 것 확인).
                let coord: number[][] | null = null;
                if (!isStraight && conn.coordinates?.length > 2) {
                    const pts = smoothSharpPolyline(conn.coordinates.filter((c: any) => c && c.lng != null && c.lat != null));
                    if (pts.length >= 2) coord = pts.map((c: any) => fromLonLat([c.lng, c.lat]));
                }
                if (!coord) {
                    let fromPt: number[], toPt: number[];
                    if (conn.coordinates?.length >= 2) {
                        fromPt = fromLonLat([conn.coordinates[0].lng, conn.coordinates[0].lat]);
                        toPt   = fromLonLat([conn.coordinates[conn.coordinates.length - 1].lng, conn.coordinates[conn.coordinates.length - 1].lat]);
                    } else {
                        const fromLaneFeat = this.laneMap.get(`${conn.fromLink}_${conn.fromLane}`);
                        const toLaneFeat   = this.laneMap.get(`${conn.toLink}_${conn.toLane}`);
                        if (fromLaneFeat && toLaneFeat) {
                            fromPt = fromLaneFeat.get('laneTarget');
                            toPt   = toLaneFeat.get('laneSource');
                        } else {
                            const fromLink = this.cachedLinkMap.get(String(conn.fromLink));
                            const toLink   = this.cachedLinkMap.get(String(conn.toLink));
                            if (!fromLink || !toLink) continue;
                            const fp = this.computeLaneEndpoint(fromLink, conn.fromLane, 'target');
                            const tp = this.computeLaneEndpoint(toLink, conn.toLane, 'source');
                            if (!fp || !tp) continue;
                            fromPt = fp;
                            toPt   = tp;
                        }
                    }
                    if (!fromPt || !toPt) continue;
                    coord = isStraight
                        ? [fromPt, toPt]
                        : this.generateQuadraticBezierCurve(fromPt, nodePt, toPt);
                }
                if (!coord || coord.length < 2) continue;
                const connFeature = new Feature(new LineString(coord));
                connFeature.setProperties({ ...conn, featureType: 'connections', fromNodeType: nextNode.type, nodeId: nextNode.id });
                existingFeatures.push(connFeature);
                addBuffer.push(connFeature);
            }

            this.nodeFeaturesMap.set(id, existingFeatures);
        }

        // 7. 신규 노드 피처 추가
        for (const node of newNodes) {
            const features = this.buildNodeFeatures(node, this.cachedLinkMap);
            const id = String(node.id);
            this.nodeFeaturesMap.set(id, features);
            this.indexNode(id, features); // 신규 노드 공간 인덱스 등록
            addBuffer.push(...features);
        }

        if (addBuffer.length === 0) return;

        if (!NETWORK_EXTENT_GATING.ENABLED) {
            this.source.addFeatures(addBuffer);
            return;
        }
        // 게이팅 활성: 캐시는 갱신됐으므로 reconcile이 화면분 멤버십을 정리한다.
        // (변경된 노드의 delta 피처, 신규 링크/노드 모두 reconcile에서 일관되게 반영)
        this.reconcile();
    }

    /** 한 링크의 bbox를 공간 인덱스에 등록 */
    private indexLink(id: string, features: Feature[]): void {
        const ext = createEmpty();
        for (const f of features) {
            const g = f.getGeometry();
            if (g) extend(ext, g.getExtent());
        }
        this.linkExtentMap.set(id, ext);
    }

    /** 한 노드의 점 좌표를 공간 인덱스에 등록 */
    private indexNode(id: string, features: Feature[]): void {
        const nodeFeat = features.find(f => f.get("featureType") === "nodes");
        const g = nodeFeat?.getGeometry();
        if (g instanceof Point) this.nodeCoordMap.set(id, g.getCoordinates());
    }

    private buildLinkFeatures(link: any, nodeMap: Map<string, any>): Feature[] {
        const sourceNode = nodeMap.get(String(link.fromNode));
        const targetNode = nodeMap.get(String(link.toNode));
        if (!sourceNode || !targetNode || !link.lanes) return [];
        if (!link.coordinates || !link.coordinates[0] || !link.coordinates[1]) return [];

        // coordinates 전체를 OL 좌표 배열로 변환 (꺾임 표현)
        const allPts: [number, number][] = link.coordinates.map((c: any) =>
            fromLonLat([c.lng, c.lat]) as [number, number]);
        if (allPts.length < 2) return [];

        const p1  = allPts[0]!;
        const p2  = allPts[allPts.length - 1]!;
        const p1b = allPts[1]!;
        if (!p1[0] || !p1[1] || !p2[0] || !p2[1]) return [];

        // 시작 방향 기준 법선 (laneSource 오프셋용)
        const dx = p1b[0] - p1[0], dy = p1b[1] - p1[1];
        const len = Math.hypot(dx, dy);
        const unitNormal: [number, number] = len > 0 ? [-dy / len, dx / len] : [0, 0];

        // 끝점 방향 법선 (laneTarget 오프셋용 — 곡선 도로 대응)
        const pLastB = allPts[allPts.length - 2]!;
        const dxE = p2[0] - pLastB[0], dyE = p2[1] - pLastB[1];
        const lenE = Math.hypot(dxE, dyE);
        const endNormal: [number, number] = lenE > 0 ? [-dyE / lenE, dxE / lenE] : unitNormal;

        const features: Feature[] = [];

        // link-edit (center line) — 모든 점 사용
        const linkLineFeature = new Feature(new LineString(allPts));
        linkLineFeature.setProperties({ ...link, featureType: "link-edit", linkRef: link.id });
        features.push(linkLineFeature);

        // link polygon — shape 전체 점을 따라가는 버퍼 폴리곤
        const half = (link.width ?? 0) / 2;
        const leftSide: number[][] = [];
        const rightSide: number[][] = [];
        for (let i = 0; i < allPts.length; i++) {
            const prev = allPts[Math.max(0, i - 1)]!;
            const next = allPts[Math.min(allPts.length - 1, i + 1)]!;
            const segDx = next[0] - prev[0], segDy = next[1] - prev[1];
            const segLen = Math.hypot(segDx, segDy);
            const nx = segLen > 0 ? -segDy / segLen : 0;
            const ny = segLen > 0 ?  segDx / segLen : 0;
            const pt = allPts[i]!;
            leftSide.push([pt[0] + nx * half, pt[1] + ny * half]);
            rightSide.push([pt[0] - nx * half, pt[1] - ny * half]);
        }
        const ring = [...leftSide, ...[...rightSide].reverse(), leftSide[0]!];
        const linkPolygonFeature = new Feature(new Polygon([ring]));
        linkPolygonFeature.setProperties({ ...link, featureType: "links" });
        features.push(linkPolygonFeature);

        // lanes
        const laneCount = link.lanes.length;
        const laneWidth = (link.width ?? 7) / laneCount;

        for (let i = 0; i < laneCount; i++) {
            const lane = link.lanes[i];
            if (!lane) continue;
            const offsetCenter = ((laneCount - 1) / 2 - i) * laneWidth;
            const centerP1 = [p1[0] + unitNormal[0] * offsetCenter, p1[1] + unitNormal[1] * offsetCenter];
            const centerP2 = [p2[0] + endNormal[0]  * offsetCenter, p2[1] + endNormal[1]  * offsetCenter];
            const halfWidth = laneWidth / 2;
            const outerP1 = [centerP1[0] + unitNormal[0] * halfWidth, centerP1[1] + unitNormal[1] * halfWidth];
            const outerP2 = [centerP2[0] + endNormal[0]  * halfWidth, centerP2[1] + endNormal[1]  * halfWidth];
            const innerP1 = [centerP1[0] - unitNormal[0] * halfWidth, centerP1[1] - unitNormal[1] * halfWidth];
            const innerP2 = [centerP2[0] - endNormal[0]  * halfWidth, centerP2[1] - endNormal[1]  * halfWidth];

            const laneProps = {
                ...lane, linkRef: link.id, featureType: "lanes",
                length: link.length, laneRef: i,
                laneSource: centerP1, laneTarget: centerP2, laneAllPts: allPts,
            };
            // 차선 폴리곤도 shape 전체 점 사용
            const laneLeft: number[][] = [];
            const laneRight: number[][] = [];
            for (let j = 0; j < allPts.length; j++) {
                const prev = allPts[Math.max(0, j - 1)]!;
                const next = allPts[Math.min(allPts.length - 1, j + 1)]!;
                const sDx = next[0] - prev[0], sDy = next[1] - prev[1];
                const sLen = Math.hypot(sDx, sDy);
                const snx = sLen > 0 ? -sDy / sLen : unitNormal[0];
                const sny = sLen > 0 ?  sDx / sLen : unitNormal[1];
                const pt = allPts[j]!;
                const cx = pt[0] + snx * offsetCenter, cy = pt[1] + sny * offsetCenter;
                laneLeft.push([cx + snx * halfWidth, cy + sny * halfWidth]);
                laneRight.push([cx - snx * halfWidth, cy - sny * halfWidth]);
            }
            const laneRing = [...laneLeft, ...[...laneRight].reverse(), laneLeft[0]!];
            const laneFeature = new Feature(new Polygon([laneRing]));
            laneFeature.setProperties(laneProps);
            this.laneMap.set(`${link.id}_${i}`, laneFeature); // 클래스 laneMap 갱신
            features.push(laneFeature);

            // 차선 중심선도 모든 점 오프셋 적용
            const laneAllPts = allPts.map(([x, y]) => [x + unitNormal[0] * offsetCenter, y + unitNormal[1] * offsetCenter]);
            const laneLineFeature = new Feature(new LineString(laneAllPts));
            laneLineFeature.setProperties({ ...laneProps, featureType: "lane-edit" });
            features.push(laneLineFeature);

            if (this.showDetail && lane.cells?.length > 0) {
                const cellWidth = laneWidth * NetworkFeatureLayer.CELL_WIDTH_RATIO;
                for (const cell of lane.cells) {
                    const startOffset = cell.offset ?? 0;
                    const unitLen = Math.max(0, cell.length ?? 5);
                    this.createRectanglesTiledAlongLane(centerP1, centerP2, startOffset, unitLen, cellWidth)
                        .forEach((ring, idx) => {
                            const cellFeature = new Feature(new Polygon([ring]));
                            cellFeature.setProperties({ ...cell, featureType: "cells", linkRef: link.id, laneRef: i, offset: startOffset + unitLen * idx, chunkIndex: idx });
                            features.push(cellFeature);
                        });
                }
            }

            if (this.showDetail && lane.segments?.length > 0) {
                const segWidth = laneWidth * NetworkFeatureLayer.SEGMENT_WIDTH_RATIO;
                for (const segment of lane.segments) {
                    const init = segment.initPoint ?? 0;
                    const end = segment.endPoint ?? init;
                    const offset = Math.min(init, end);
                    const length = Math.max(0, Math.abs(end - init));
                    const ring = this.createRectangleAlongLane(centerP1, centerP2, offset, length, segWidth);
                    if (!ring) continue;
                    const segFeature = new Feature(new Polygon([ring]));
                    segFeature.setProperties({ ...segment, featureType: "segments", linkRef: link.id, laneRef: i, offset, length });
                    features.push(segFeature);
                }
            }
        }
        return features;
    }

    private buildNodeFeatures(node: any, linkMap: Map<string, any>): Feature[] {
        const features: Feature[] = [];
        const nodePt = fromLonLat([node.coordinates.lng, node.coordinates.lat]);

        const nodeFeature = new Feature(new Point(nodePt));
        nodeFeature.setProperties({ ...node, featureType: "nodes" });
        features.push(nodeFeature);

        for (const conn of (node.connections ?? [])) {
            const isStraight = normalizeTurning(conn.turning) === 'Straight';
            // 3점 이상 = 변환기가 내부링크 경로(교통섬 순환·회전 동선)로 생성한 폴리라인 —
            // 회전 커넥션만 사용(완만한 실측은 그대로, 급꺾임은 코너 스무딩). 직진은 원본에
            // 중간 경유점이 있어도 여러 차선이 같은 경유점으로 합성돼(KTDB 내부링크 생성 시
            // 차선별 분리 없이 공유) 교차로 중앙에서 겹쳐 보이는 인공물이 되므로, 직진은
            // 항상 시작~끝 2점 직선으로 그린다(실사용 발견).
            let coord: Coordinate[] | null = null;
            if (!isStraight && conn.coordinates?.length > 2) {
                const pts = smoothSharpPolyline(conn.coordinates.filter((c: any) => c && c.lng != null && c.lat != null));
                if (pts.length >= 2) coord = pts.map((c: any) => fromLonLat([c.lng, c.lat]));
            }
            if (!coord) {
                let fromPt: Coordinate, toPt: Coordinate;

                if (conn.coordinates?.length >= 2) {
                    fromPt = fromLonLat([conn.coordinates[0].lng, conn.coordinates[0].lat]);
                    toPt = fromLonLat([conn.coordinates[conn.coordinates.length - 1].lng, conn.coordinates[conn.coordinates.length - 1].lat]);
                } else {
                    const fromLaneFeat = this.laneMap.get(`${conn.fromLink}_${conn.fromLane}`);
                    const toLaneFeat = this.laneMap.get(`${conn.toLink}_${conn.toLane}`);
                    if (fromLaneFeat && toLaneFeat) {
                        fromPt = fromLaneFeat.get("laneTarget");
                        toPt = toLaneFeat.get("laneSource");
                    } else {
                        const fromLink = linkMap.get(String(conn.fromLink));
                        const toLink = linkMap.get(String(conn.toLink));
                        if (!fromLink || !toLink) continue;
                        const fp = this.computeLaneEndpoint(fromLink, conn.fromLane, 'target');
                        const tp = this.computeLaneEndpoint(toLink, conn.toLane, 'source');
                        if (!fp || !tp) continue;
                        fromPt = fp;
                        toPt = tp;
                    }
                }
                if (!fromPt || !toPt) continue;

                coord = isStraight
                    ? [fromPt, toPt]
                    : this.generateQuadraticBezierCurve(fromPt, fromLonLat([node.coordinates.lng, node.coordinates.lat]), toPt);
            }
            if (!coord || coord.length < 2) continue;

            const connFeature = new Feature(new LineString(coord));
            connFeature.setProperties({ ...conn, featureType: "connections", fromNodeType: node.type, nodeId: node.id });
            features.push(connFeature);
        }

        for (const port of (node.ports ?? [])) {
            const link = linkMap.get(String(port.linkId));
            if (!link) continue;

            if (port.type === "out" && link.coordinates?.[0]) {
                // out 포트: 원형 마커
                const portPos = fromLonLat([link.coordinates[0].lng, link.coordinates[0].lat]);
                const portFeature = new Feature({ ...port, geometry: new Point(portPos), featureType: "ports" });
                features.push(portFeature);

            } else if (port.type === "in" && link.coordinates?.length >= 2) {
                // in 포트: 정지선 (링크 끝점에 수직인 선) + 원형 마커
                const coords = link.coordinates;
                const p1 = fromLonLat([coords[coords.length - 2].lng, coords[coords.length - 2].lat]);
                const p2 = fromLonLat([coords[coords.length - 1].lng, coords[coords.length - 1].lat]);

                const dx = p2[0] - p1[0];
                const dy = p2[1] - p1[1];
                const len = Math.sqrt(dx * dx + dy * dy);
                if (len > 0) {
                    // 수직 단위벡터 (EPSG:3857 — 단위 ≈ meter)
                    const px = -dy / len;
                    const py =  dx / len;
                    const halfW = (link.width ?? 7) / 2;
                    const stopLine = new LineString([
                        [p2[0] - px * halfW, p2[1] - py * halfW],
                        [p2[0] + px * halfW, p2[1] + py * halfW],
                    ]);
                    const stopFeature = new Feature({ ...port, geometry: stopLine, featureType: "ports" });
                    features.push(stopFeature);
                }

                // 원형 마커도 유지
                const last = coords[coords.length - 1];
                const portFeature = new Feature({ ...port, geometry: new Point(fromLonLat([last.lng, last.lat])), featureType: "ports" });
                features.push(portFeature);
            }
        }
        return features;
    }

    private computeLaneEndpoint(link: any, laneIdx: number, side: 'source' | 'target'): number[] | null {
        if (!link?.coordinates || link.coordinates.length < 2) return null;
        const allPts: [number, number][] = link.coordinates.map((c: any) =>
            fromLonLat([c.lng, c.lat]) as [number, number]);
        const p1 = allPts[0]!;
        const p1b = allPts[1]!;
        const p2 = allPts[allPts.length - 1]!;
        const dx = p1b[0] - p1[0], dy = p1b[1] - p1[1];
        const len = Math.hypot(dx, dy);
        const ux = len > 0 ? -dy / len : 0;
        const uy = len > 0 ? dx / len : 0;
        const laneCount = link.lanes?.length ?? 1;
        const laneWidth = (link.width ?? 7) / laneCount;
        const offsetCenter = ((laneCount - 1) / 2 - laneIdx) * laneWidth;
        const pt = side === 'source' ? p1 : p2;
        return [pt[0] + ux * offsetCenter, pt[1] + uy * offsetCenter];
    }

    private measureChunkLength(source: Coordinate, target: Coordinate, ring: Coordinate[]): number {
        if (ring.length < 4) return 0;
        const leftStart = ring[0];
        const leftEnd = ring[1];
        const rightEnd = ring[2];
        const rightStart = ring[3];

        const midStart = [(leftStart[0] + rightStart[0]) / 2, (leftStart[1] + rightStart[1]) / 2];
        const midEnd = [(leftEnd[0] + rightEnd[0]) / 2, (leftEnd[1] + rightEnd[1]) / 2];

        const dx = midEnd[0] - midStart[0];
        const dy = midEnd[1] - midStart[1];
        return Math.hypot(dx, dy);
    }

    public dispose(): void {
        this.unsubscribe?.();
        this.unsubscribeDraw?.();
        this.unsubscribeMode?.();
        this.unsubscribeEdit?.();
        this.unsubscribeChanged?.();
        this.unsubscribeSel?.();
        if (this.moveEndKey) { unByKey(this.moveEndKey); this.moveEndKey = null; }
        if (this.visChangeKey) { unByKey(this.visChangeKey); this.visChangeKey = null; }
        this.tileManager?.clear();
        this.tileManager = null;
        this.lastLoadedExtent = null;
        useNetworkTileStore.getState().setGridDataStatus(false, false);
        if (this.storeSyncTimer) { clearTimeout(this.storeSyncTimer); this.storeSyncTimer = null; }
        if (this.mvtLayer) { try { this.mvtLayer.setMap(null); } catch (_) {} this.mvtLayer = null; }
        if (this.editOverlayLayer) { try { this.editOverlayLayer.setMap(null); } catch (_) {} this.editOverlayLayer = null; this.editOverlaySource = null; }
        if (this.selHighlightLayer) { try { this.selHighlightLayer.setMap(null); } catch (_) {} this.selHighlightLayer = null; this.selHighlightSource = null; }
        super.dispose();
    }
}
