import { Viewer } from "cesium";
import * as Cesium from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { useScenarioStore } from "@stores/useScenarioStore";
import { Network } from "@type/Network";
import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";

// --- 이벤트 핸들러에서 Primitive 피킹/하이라이트에 사용 ---
export const networkPrimitivePropertiesMap = new Map<string, any>();
export let highlightNetworkPrimitive: ((guid: string | null) => void) | null = null;

export default class NetworkDataSourceLayer {
    private readonly LAYER_NAME = "network";
    // 노드·포트·커넥션은 Entity (실린더/화살표 머티리얼, 수가 적음)
    private dataSource: Cesium.CustomDataSource;
    // 링크 Primitive (featureType별 독립 on/off를 위해 분리)
    private linkOutlinePrimitive: Cesium.Primitive | null = null;  // 외곽선(그림자 효과)
    private linkPrimitive: Cesium.Primitive | null = null;
    // 레인 Primitive
    private lanePrimitive: Cesium.Primitive | null = null;
    // 레인 경계선 Primitive
    private laneDividerPrimitive: Cesium.Primitive | null = null;
    // 중앙선 Primitive
    private centerLinePrimitive: Cesium.Primitive | null = null;

    // featureType별 가시성 상태
    private featureTypeVisible: Record<string, boolean> = {};
    private destroyed = false;

    // ── 색상 팔레트 ─────────────────────────────────────────────
    // 아스팔트 도로 기본 (외곽 → 메인 순)
    private static readonly COLOR_LINK_OUTLINE = Cesium.Color.fromBytes(15, 15, 15, 200);   // 외곽 그림자
    private static readonly COLOR_LINK_BASE    = Cesium.Color.fromBytes(50, 52, 56, 245);   // 아스팔트 기본

    // 레인 교차 음영 (짝/홀)
    private static readonly LANE_COLORS = [
        Cesium.Color.fromBytes(42, 44, 48, 255),
        Cesium.Color.fromBytes(56, 58, 62, 255),
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

    // LOD 고도 임계값 (미터, 카메라 타원체 기준)
    private static readonly LOD_LINK_ONLY    = 3000;   // > 3km → 링크만 (레인 숨김)
    private static readonly LOD_OUTLINE_ONLY = 10000;  // > 10km → 외곽선만
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
    private cachedNodeMap: Map<string, any> = new Map();
    private cachedLinkMap: Map<string, any> = new Map();
    private lanePositionMap: Map<string, { source: Cesium.Cartesian3; target: Cesium.Cartesian3 }> = new Map();
    private nodeEntityIds: Map<string, string[]> = new Map();



    // 하이라이트 상태
    private highlightedGuid: string | null = null;
    private originalHighlightColor: Uint8Array | null = null;

    constructor(private viewer: Viewer) {
        this.dataSource = new Cesium.CustomDataSource(this.LAYER_NAME);
        this.viewer.dataSources.add(this.dataSource);

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
        if (newLod === this.currentLod) return;
        this.currentLod = newLod;
        this.applyVisibility();
        try { this.viewer.scene.requestRender(); } catch (_) {}
    }

    private applyVisibility(): void {
        const layer   = this._layerVisible;
        const linkFT  = this.featureTypeVisible['links'] ?? true;
        const laneFT  = this.featureTypeVisible['lanes'] ?? true;
        const showLinks = layer && linkFT;
        const showLanes = layer && laneFT && this.currentLod === 'full';

        if (this.linkOutlinePrimitive)  this.linkOutlinePrimitive.show  = showLinks;
        if (this.linkPrimitive)         this.linkPrimitive.show         = showLinks && this.currentLod !== 'outline';
        if (this.lanePrimitive)         this.lanePrimitive.show         = showLanes;
        if (this.laneDividerPrimitive)  this.laneDividerPrimitive.show  = showLanes;
        if (this.centerLinePrimitive)   this.centerLinePrimitive.show   = showLanes;
        this.dataSource.show = layer && this.currentLod === 'full';
        this.viewer.scene.globe.depthTestAgainstTerrain = !layer;
    }

    // ─────────────────────────────────────────────
    // Primitive 하이라이트 (이벤트 핸들러에서 호출)
    // ─────────────────────────────────────────────
    private highlightInstance(guid: string | null): void {
        // 이전 하이라이트 복원 (링크 또는 레인 Primitive에서 찾아서 복원)
        if (this.highlightedGuid && this.originalHighlightColor) {
            for (const p of [this.linkPrimitive, this.lanePrimitive]) {
                if (!p?.ready) continue;
                try {
                    const attrs = p.getGeometryInstanceAttributes(this.highlightedGuid);
                    if (attrs) { attrs.color = this.originalHighlightColor; break; }
                } catch (_) {}
            }
        }
        this.highlightedGuid = null;
        this.originalHighlightColor = null;

        if (guid) {
            for (const p of [this.linkPrimitive, this.lanePrimitive]) {
                if (!p?.ready) continue;
                try {
                    const attrs = p.getGeometryInstanceAttributes(guid);
                    if (attrs?.color) {
                        this.originalHighlightColor = new Uint8Array(attrs.color);
                        attrs.color = Cesium.ColorGeometryInstanceAttribute.toValue(Cesium.Color.YELLOW.withAlpha(0.9));
                        try { this.viewer.scene.requestRender(); } catch (_) {}
                        break;
                    }
                } catch (_) {}
            }
        }
        this.highlightedGuid = guid;
    }

    // ─────────────────────────────────────────────
    // 진입점
    // ─────────────────────────────────────────────
    public load(): void {
        const store = layerNameToStoreMap[this.LAYER_NAME];
        const network: Network | undefined = store?.getState().currentJsonData;
        if (!network || !network.nodes || !network.links) {
            console.warn('[NetworkDataSourceLayer.load] 데이터 없음 또는 구조 불일치', network ? Object.keys(network) : 'null');
            return;
        }

        console.log(`[NetworkDataSourceLayer.load] nodes=${network.nodes.length}, links=${network.links.length}, dataSource.show=${this.dataSource.show}`);

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
        // 지형 고도 샘플링 (지형 없으면 즉시 반환)
        await this.sampleTerrainHeights(network);
        if (this.destroyed) return; // await 이후 destroy된 경우 중단

        this.nodeEntityIds.clear();
        this.lanePositionMap.clear();
        networkPrimitivePropertiesMap.clear();

        this.cachedNodeMap = new Map(network.nodes.map(n => [String(n.id), n]));
        this.cachedLinkMap = new Map(network.links.map(l => [String(l.id), l]));

        // 링크·레인 → Primitive (featureType별 분리)
        const linkOutlineInstances: Cesium.GeometryInstance[] = [];
        const linkInstances: Cesium.GeometryInstance[] = [];
        const laneInstances: Cesium.GeometryInstance[] = [];
        const dividerInstances: Cesium.GeometryInstance[] = [];
        const centerLineInstances: Cesium.GeometryInstance[] = [];
        for (const link of network.links) {
            this.buildLinkInstances(link, this.cachedNodeMap, linkOutlineInstances, linkInstances, laneInstances, dividerInstances, centerLineInstances);
        }
        this.rebuildPrimitives(linkOutlineInstances, linkInstances, laneInstances, dividerInstances, centerLineInstances);

        // 노드·포트·커넥션 → DataSource Entity
        // suspendEvents()+removeAll()은 렌더 틱과 race를 일으켜
        // StaticGroundPolylinePerMaterialBatch 내부 _items에 undefined 슬롯을 만든다.
        // viewer에서 완전히 제거 후 새 DataSource로 교체하면 배치 오염이 없다.
        this.viewer.dataSources.remove(this.dataSource, true);
        this.dataSource = new Cesium.CustomDataSource(this.LAYER_NAME);
        for (const node of network.nodes) {
            this.buildNodeEntities(node, this.cachedLinkMap, this.cachedNodeMap);
        }
        this.viewer.dataSources.add(this.dataSource);
        // LOD + 레이어 가시성 일괄 적용 (depthTestAgainstTerrain 포함)
        this.applyVisibility();
        try { this.viewer.scene.requestRender(); } catch (_) {}
    }

    private rebuildPrimitives(
        linkOutlineInstances: Cesium.GeometryInstance[],
        linkInstances: Cesium.GeometryInstance[],
        laneInstances: Cesium.GeometryInstance[],
        dividerInstances: Cesium.GeometryInstance[],
        centerLineInstances: Cesium.GeometryInstance[]
    ): void {
        // 기존 Primitive 제거
        if (this.linkOutlinePrimitive) {
            this.viewer.scene.primitives.remove(this.linkOutlinePrimitive);
            this.linkOutlinePrimitive = null;
        }
        if (this.linkPrimitive) {
            this.viewer.scene.primitives.remove(this.linkPrimitive);
            this.linkPrimitive = null;
        }
        if (this.lanePrimitive) {
            this.viewer.scene.primitives.remove(this.lanePrimitive);
            this.lanePrimitive = null;
        }
        if (this.laneDividerPrimitive) {
            this.viewer.scene.primitives.remove(this.laneDividerPrimitive);
            this.laneDividerPrimitive = null;
        }
        if (this.centerLinePrimitive) {
            this.viewer.scene.primitives.remove(this.centerLinePrimitive);
            this.centerLinePrimitive = null;
        }
        // 하이라이트 상태 초기화 (이전 primitive 참조 무효)
        this.highlightedGuid = null;
        this.originalHighlightColor = null;

        const appearance = () => new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true });

        // 외곽 그림자 (가장 먼저, 가장 아래)
        if (linkOutlineInstances.length > 0) {
            this.linkOutlinePrimitive = new Cesium.Primitive({
                geometryInstances: linkOutlineInstances,
                appearance: appearance(),
                asynchronous: true,
                show: true,
            });
            this.viewer.scene.primitives.add(this.linkOutlinePrimitive);
        }

        if (linkInstances.length > 0) {
            this.linkPrimitive = new Cesium.Primitive({
                geometryInstances: linkInstances,
                appearance: appearance(),
                asynchronous: true,
                show: true,
            });
            this.viewer.scene.primitives.add(this.linkPrimitive);
        }

        if (laneInstances.length > 0) {
            this.lanePrimitive = new Cesium.Primitive({
                geometryInstances: laneInstances,
                appearance: appearance(),
                asynchronous: true,
                show: true,
            });
            this.viewer.scene.primitives.add(this.lanePrimitive);
        }

        if (dividerInstances.length > 0) {
            this.laneDividerPrimitive = new Cesium.Primitive({
                geometryInstances: dividerInstances,
                appearance: appearance(),
                asynchronous: true,
                show: true,
            });
            this.viewer.scene.primitives.add(this.laneDividerPrimitive);
        }

        if (centerLineInstances.length > 0) {
            this.centerLinePrimitive = new Cesium.Primitive({
                geometryInstances: centerLineInstances,
                appearance: appearance(),
                asynchronous: true,
                show: true,
            });
            this.viewer.scene.primitives.add(this.centerLinePrimitive);
        }
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

        // 새 링크가 있으면 전체 링크 기준으로 Primitive 재빌드
        // (Primitive는 인스턴스 추가가 불가하므로 전체 재생성)
        if (newLinks.length > 0) {
            networkPrimitivePropertiesMap.clear();
            this.lanePositionMap.clear();
            const linkOutlineInstances: Cesium.GeometryInstance[] = [];
            const linkInstances: Cesium.GeometryInstance[] = [];
            const laneInstances: Cesium.GeometryInstance[] = [];
            const dividerInstances: Cesium.GeometryInstance[] = [];
            const centerLineInstances: Cesium.GeometryInstance[] = [];
            for (const link of next.links) {
                this.buildLinkInstances(link, this.cachedNodeMap, linkOutlineInstances, linkInstances, laneInstances, dividerInstances, centerLineInstances);
            }
            this.rebuildPrimitives(linkOutlineInstances, linkInstances, laneInstances, dividerInstances, centerLineInstances);
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

            // 로컬 접선 방향 (앞뒤 점의 평균)
            const dir = Cesium.Cartesian3.normalize(
                Cesium.Cartesian3.subtract(nextPos, prevPos, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );
            // 타원체 법선 (up 벡터)
            const up = Cesium.Cartesian3.normalize(curPos, new Cesium.Cartesian3());
            // 수평면 내 right 벡터 = dir × up
            const right = Cesium.Cartesian3.normalize(
                Cesium.Cartesian3.cross(dir, up, new Cesium.Cartesian3()),
                new Cesium.Cartesian3()
            );

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

        const positions = conn.turning === 'Straight'
            ? [fromPt, toPt]
            : this.generateQuadraticBezierCurve(
                fromPt,
                Cesium.Cartesian3.fromDegrees(node.coordinates.lng, node.coordinates.lat),
                toPt
            );

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
        // 레이어 제거 시 지형 depth test 복원
        try { this.viewer.scene.globe.depthTestAgainstTerrain = true; } catch (_) {}
        this.unsubscribe?.();
        this.unsubscribeDraw?.();
        for (const p of [this.linkOutlinePrimitive, this.linkPrimitive, this.lanePrimitive, this.laneDividerPrimitive, this.centerLinePrimitive]) {
            if (p) this.viewer.scene.primitives.remove(p);
        }
        this.linkOutlinePrimitive = null;
        this.linkPrimitive = null;
        this.lanePrimitive = null;
        this.laneDividerPrimitive = null;
        this.centerLinePrimitive = null;
        if (this.dataSource) {
            this.viewer.dataSources.remove(this.dataSource, true);
        }
        if (highlightNetworkPrimitive === this.highlightInstance) {
            highlightNetworkPrimitive = null;
        }
        networkPrimitivePropertiesMap.clear();
    }
}
