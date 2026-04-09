import * as Cesium from "cesium";
import { CustomDataSource, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useSignalTimelineStore, SignalTimelineResponse } from "@stores/useSignalTimelineStore";
import { signalRenderState } from "@stores/signalRenderState";
import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";

/* ─────────────────────────────────────────────────────────────────
   LOD 전략 (단순화: 줌아웃 시 크기 고정)
   ① 0 ~ DIST_POLE  : 폴(3D entity) + 신호면 빌보드(고정 픽셀)
   ② 0 ~ DIST_SHOW  : 신호면 빌보드 (단일 고정 픽셀 크기)
   ③ DIST_SHOW ~ DIST_DOT : 컬러 dot (PointPrimitive)
   ────────────────────────────────────────────────────────────── */
const DIST_POLE =   80;    // 폴 가시 거리 (m)
const DIST_SHOW =  400;    // 신호면 billboard 표시 거리 (단일 고정 크기)
const DIST_DOT  = 1000;    // "S" 아이콘 표시 거리

/* ── 물리 치수 ── */
const POLE_HEIGHT = 6.0;
const POLE_RADIUS = 0.06;

/* ── 신호면 빌보드 크기 (고정 px, 줌과 무관) ── */
const BB_W = 28;   // billboard 가로 (px)
const BB_H = 76;   // billboard 세로 (px)

/* ── 원거리 아이콘 (모듈 레벨, 1회 생성) ── */
const SIGNAL_ICON = (() => {
    const size = 20;
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d")!;
    const r = size / 2;
    ctx.beginPath(); ctx.arc(r, r, r - 1.5, 0, Math.PI * 2);
    ctx.fillStyle = "#3c3c3c"; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = "white";
    ctx.font = `bold ${Math.round(size * 0.45)}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("S", r, r + 0.5);
    return c.toDataURL();
})();

/* ── Cesium 색상 ── */
const C_POLE = Cesium.Color.fromCssColorString("#3c3c3c");

function pos(lng: number, lat: number, h: number): Cesium.Cartesian3 {
    return Cesium.Cartesian3.fromDegrees(lng, lat, h);
}
function toWallClock(jd: Cesium.JulianDate): string {
    const d = Cesium.JulianDate.toDate(jd);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
function isoToTime(iso: string): string { return iso.substring(11, 19); }

/* ─────────────────────────────────────────────────────────────────
   캔버스 렌더링
   ────────────────────────────────────────────────────────────── */
function drawFace(
    canvas: HTMLCanvasElement,
    redOn: boolean, yellowOn: boolean, greenOn: boolean,
    leftOn: boolean | null, rightOn: boolean | null,
): void {
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);

    /* 하우징 */
    ctx.fillStyle = "#1a1c1f";
    ctx.beginPath();
    (ctx as any).roundRect(0, 0, W, H, Math.round(W * 0.15));
    ctx.fill();
    ctx.strokeStyle = "#444";
    ctx.lineWidth   = 1;
    ctx.stroke();

    /* 램프 위치: H의 1/6, 1/2, 5/6  (화살표 여백 포함 시 약간 위로) */
    const hasArrow = leftOn !== null || rightOn !== null;
    const lampAreaH = hasArrow ? H * 0.84 : H;
    const cx = W / 2;
    const r  = Math.round(W / 2 - W * 0.18);   // 하우징 너비의 64%
    const yR = Math.round(lampAreaH / 6);
    const yY = Math.round(lampAreaH / 2);
    const yG = Math.round(lampAreaH * 5 / 6);

    const lamps = [
        { y: yR, on: redOn,    onC: "#ff3333", offC: "#280000", glowC: "rgba(255,50,50,0.55)"  },
        { y: yY, on: yellowOn, onC: "#ffd700", offC: "#282000", glowC: "rgba(255,215,0,0.55)"  },
        { y: yG, on: greenOn,  onC: "#00e868", offC: "#002810", glowC: "rgba(0,232,104,0.55)"  },
    ];

    for (const lp of lamps) {
        /* 소켓 */
        ctx.beginPath();
        ctx.arc(cx, lp.y, r + 1, 0, Math.PI * 2);
        ctx.fillStyle = "#0c0c0f";
        ctx.fill();

        /* 글로우 */
        if (lp.on) {
            const g = ctx.createRadialGradient(cx, lp.y, 0, cx, lp.y, r * 2.0);
            g.addColorStop(0, lp.glowC);
            g.addColorStop(1, "transparent");
            ctx.beginPath();
            ctx.arc(cx, lp.y, r * 2.0, 0, Math.PI * 2);
            ctx.fillStyle = g;
            ctx.fill();
        }

        /* 램프 */
        ctx.beginPath();
        ctx.arc(cx, lp.y, r, 0, Math.PI * 2);
        ctx.fillStyle = lp.on ? lp.onC : lp.offC;
        ctx.fill();

        /* 하이라이트 */
        if (lp.on) {
            const hl = ctx.createRadialGradient(cx - r * 0.3, lp.y - r * 0.35, 0, cx, lp.y, r);
            hl.addColorStop(0, "rgba(255,255,255,0.42)");
            hl.addColorStop(1, "transparent");
            ctx.beginPath();
            ctx.arc(cx, lp.y, r, 0, Math.PI * 2);
            ctx.fillStyle = hl;
            ctx.fill();
        }

        /* 차양 */
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(1, lp.y - r - Math.ceil(r * 0.45), W - 2, Math.ceil(r * 0.4));
    }

    /* 방향 화살표 */
    if (hasArrow) {
        const ay = Math.round(H * 0.91);
        const fs = Math.max(8, Math.round(r * 0.9));
        ctx.font = `bold ${fs}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const both = leftOn !== null && rightOn !== null;
        if (leftOn !== null) {
            ctx.fillStyle = leftOn ? "#00e868" : "#003d18";
            ctx.fillText("◀", cx + (both ? -r * 0.7 : 0), ay);
        }
        if (rightOn !== null) {
            ctx.fillStyle = rightOn ? "#00e868" : "#003d18";
            ctx.fillText("▶", cx + (both ? r * 0.7 : 0), ay);
        }
    }
}

/* ─────────────────────────────────────────────────────────────────
   인터페이스
   ────────────────────────────────────────────────────────────── */
interface SignalLamp {
    nodeId: string; fromLinkId: string;
    mainConnGuids: string[]; mainConnIds: string[];
    leftConnGuids: string[]; leftConnIds: string[];
    rightConnGuids: string[]; rightConnIds: string[];
    hasLeft: boolean; hasRight: boolean;
    // 단일 고정 픽셀 billboard (줌 무관 크기)
    canvas:       HTMLCanvasElement;
    billboard:    Cesium.Billboard;
    // 원거리 "S" 아이콘 billboard
    farBillboard: Cesium.Billboard;
}

/* ─────────────────────────────────────────────────────────────────
   메인 클래스
   ────────────────────────────────────────────────────────────── */
export default class SignalDataSourceLayer {
    private readonly LAYER_NAME = "signal";
    public readonly dataSource:  CustomDataSource;
    private billboardCollection: Cesium.BillboardCollection;
    private farBillboards:       Cesium.BillboardCollection;
    private signalLamps:  SignalLamp[] = [];
    private unsubscribes: Array<() => void> = [];
    private lastWallClock = "";
    private renderInterval: ReturnType<typeof setInterval> | null = null;
    private visible    = true;
    private destroyed  = false;
    private needsReload = false;

    constructor(private viewer: Viewer) {
        this.dataSource = new CustomDataSource(this.LAYER_NAME);
        this.viewer.dataSources.add(this.dataSource);

        this.billboardCollection = new Cesium.BillboardCollection({ scene: this.viewer.scene });
        this.farBillboards       = new Cesium.BillboardCollection({ scene: this.viewer.scene });
        this.viewer.scene.primitives.add(this.billboardCollection);
        this.viewer.scene.primitives.add(this.farBillboards);

        this.load();
        this.viewer.scene.preRender.addEventListener(this.onPreRender);
        this.renderInterval = setInterval(() => {
            if (this.signalLamps.length > 0) {
                try { this.viewer.scene.requestRender(); } catch (_) {}
            }
        }, 500);

        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribes.push((store as any).subscribe(
                (s: any) => s.currentJsonData,
                () => this.load(),
                { equalityFn: (a: any, b: any) => a === b }
            ));
        }
        this.unsubscribes.push((useNetworkStore as any).subscribe(
            (s: any) => s.currentJsonData,
            () => this.load(),
            { equalityFn: (a: any, b: any) => a === b }
        ));
        this.unsubscribes.push((useSignalTimelineStore as any).subscribe(
            (s: any) => s.signalTimeline,
            () => { this.lastWallClock = ""; }
        ));
    }

    /* ── 상태 갱신 (preRender: 1초 1회) ── */
    private onPreRender = () => {
        if (this.signalLamps.length === 0) return;
        const wallClock = toWallClock(this.viewer.clock.currentTime);
        if (wallClock === this.lastWallClock) return;
        this.lastWallClock = wallClock;

        const timeline: SignalTimelineResponse[] | undefined =
            useSignalTimelineStore.getState().signalTimeline;
        if (!timeline?.length) return;

        const activeConns = new Map<string, Set<string>>();
        const nodeState   = new Map<string, string>();

        for (const entry of timeline) {
            const nodeId = String(entry.nodeId);
            const cur = entry.signalTimeline.find(
                s => wallClock >= isoToTime(s.startTime) && wallClock < isoToTime(s.endTime)
            );
            if (!cur) continue;
            nodeState.set(nodeId, cur.signalState);
            const ag = new Set<string>();
            for (const tid of cur.activeTurns) {
                const t = entry.turnInfo.find(t => t.id === tid);
                if (t) t.connList.forEach((g: string) => ag.add(g));
            }
            activeConns.set(nodeId, ag);
        }

        signalRenderState.nodeState   = nodeState;
        signalRenderState.activeConns = activeConns;

        for (const lamp of this.signalLamps) {
            const state   = nodeState.get(lamp.nodeId);
            const actives = activeConns.get(lamp.nodeId);

            const allG = [...lamp.mainConnGuids, ...lamp.leftConnGuids, ...lamp.rightConnGuids];
            const allI = [...lamp.mainConnIds,   ...lamp.leftConnIds,   ...lamp.rightConnIds];
            const chkG = lamp.mainConnGuids.length > 0 ? lamp.mainConnGuids : allG;
            const chkI = lamp.mainConnIds.length   > 0 ? lamp.mainConnIds   : allI;
            const mainGreen = chkG.some(g => actives?.has(g)) || chkI.some(id => actives?.has(id));

            const isYellow = state === "yellow";
            const redOn    = !isYellow && !mainGreen;
            const yellowOn = isYellow;
            const greenOn  = !isYellow && mainGreen;

            const leftOn  = lamp.hasLeft  ? (lamp.leftConnGuids.some(g => actives?.has(g))
                || lamp.leftConnIds.some(id => actives?.has(id)))  : null;
            const rightOn = lamp.hasRight ? (lamp.rightConnGuids.some(g => actives?.has(g))
                || lamp.rightConnIds.some(id => actives?.has(id))) : null;

            /* 캔버스 재그리기 */
            drawFace(lamp.canvas, redOn, yellowOn, greenOn, leftOn, rightOn);
            lamp.billboard.image = lamp.canvas.toDataURL();
        }
    };

    public setVisible(visible: boolean): void {
        this.visible = visible;
        this.dataSource.show          = visible;
        this.billboardCollection.show = visible;
        this.farBillboards.show       = visible;
        if (visible && this.needsReload) this.load();
    }

    public load(): void {
        const ds = useNetworkDrawStore.getState();
        if (ds.isActive || ds.isConnectionActive) return;
        this.loadAsync().catch(e => console.error("SignalDataSourceLayer.load() 에러:", e));
    }

    private async loadAsync(): Promise<void> {
        if (!this.visible) { this.needsReload = true; return; }
        this.needsReload = false;

        this.billboardCollection.removeAll();
        this.farBillboards.removeAll();
        this.signalLamps = [];
        this.lastWallClock = "";

        const signalStore = layerNameToStoreMap[this.LAYER_NAME];
        if (!signalStore) return;
        const signals: any[] = (signalStore as any).getState().currentJsonData?.signals ?? [];
        if (!signals.length) return;

        const networkData = (useNetworkStore as any).getState().currentJsonData;
        if (!networkData?.nodes || !networkData?.links) return;

        const signalNodeIds = new Set(signals.map((s: any) => String(s.nodeId)));
        const guidMap = new Map<string, string>();
        for (const s of signals) {
            const nid = String(s.nodeId);
            if (!guidMap.has(nid)) guidMap.set(nid, s.__guid ?? nid);
        }
        const connMap = new Map<string, any[]>();
        for (const node of networkData.nodes) {
            connMap.set(String(node.id), node.connections ?? []);
        }

        interface Entry {
            lng: number; lat: number;
            toNodeId: string; fromLinkId: string; signalGuid: string;
            mainG: string[]; mainI: string[];
            leftG: string[]; leftI: string[];
            rightG: string[]; rightI: string[];
        }
        const entries: Entry[] = [];

        for (const link of networkData.links) {
            const toNodeId = String(link.toNode);
            if (!signalNodeIds.has(toNodeId)) continue;
            if (!link.coordinates?.length) continue;
            const last = link.coordinates[link.coordinates.length - 1];
            if (!last) continue;

            const fromLinkId = String(link.id);
            const conns = connMap.get(toNodeId) ?? [];
            const mainG: string[] = [], mainI: string[] = [];
            const leftG: string[] = [], leftI: string[] = [];
            const rightG: string[] = [], rightI: string[] = [];

            for (const c of conns) {
                if (String(c.fromLink) !== fromLinkId) continue;
                const t    = c.turning ? String(c.turning) : "Straight";
                const guid = c.__guid ?? String(c.id);
                const id   = String(c.id);
                if (t === "Left_Turn" || t === "Left" || t === "L") {
                    leftG.push(guid); leftI.push(id);
                } else if (t === "Right_Turn" || t === "Right" || t === "R") {
                    rightG.push(guid); rightI.push(id);
                } else {
                    mainG.push(guid); mainI.push(id);
                }
            }
            entries.push({
                lng: last.lng, lat: last.lat, toNodeId, fromLinkId,
                signalGuid: guidMap.get(toNodeId) ?? toNodeId,
                mainG, mainI, leftG, leftI, rightG, rightI,
            });
        }
        if (!entries.length) return;

        /* 지형 고도 샘플링 */
        const terrainMap = new Map<string, number>();
        const hasReal = !(this.viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider);
        if (hasReal) {
            const key = (lng: number, lat: number) => `${lng.toFixed(5)},${lat.toFixed(5)}`;
            const uk: string[] = [], uc: Cesium.Cartographic[] = [];
            for (const e of entries) {
                const k = key(e.lng, e.lat);
                if (!terrainMap.has(k)) {
                    terrainMap.set(k, 0);
                    uk.push(k);
                    uc.push(Cesium.Cartographic.fromDegrees(e.lng, e.lat));
                }
            }
            try {
                await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, uc);
                for (let i = 0; i < uk.length; i++) terrainMap.set(uk[i]!, uc[i]!.height ?? 0);
            } catch (err) {
                console.warn("SignalDataSourceLayer: 지형 고도 샘플링 실패", err);
            }
        }

        this.dataSource.entities.suspendEvents();
        try {
            this.dataSource.entities.removeAll();
            const key = (lng: number, lat: number) => `${lng.toFixed(5)},${lat.toFixed(5)}`;
            for (const e of entries) {
                this.addLight(e, terrainMap.get(key(e.lng, e.lat)) ?? 0);
            }
            this.billboardCollection.show = this.visible;
            this.farBillboards.show       = this.visible;
            if (this.dataSource.entities.values.length > 0) this.dataSource.show = this.visible;
            console.log(`SignalDataSourceLayer: ${this.signalLamps.length}개 신호등 로드`);
        } finally {
            this.dataSource.entities.resumeEvents();
            try { this.viewer.scene.requestRender(); } catch (_) {}
        }
    }

    private addLight(e: {
        lng: number; lat: number; toNodeId: string; fromLinkId: string; signalGuid: string;
        mainG: string[]; mainI: string[];
        leftG: string[]; leftI: string[];
        rightG: string[]; rightI: string[];
    }, baseH: number): void {
        const { lng, lat, toNodeId: nodeId, fromLinkId, signalGuid } = e;
        const poleTopH = baseH + POLE_HEIGHT;
        const headCtrH = poleTopH + 0.3;   // 폴 상단에서 살짝 위

        const sharedProps = new Cesium.PropertyBag({
            __guid: signalGuid, featureType: "signals", nodeId, fromLinkId,
        });

        /* ① 투명 피커 */
        this.dataSource.entities.add(new Cesium.Entity({
            id: `signal-pick-${nodeId}-${fromLinkId}`,
            position: pos(lng, lat, baseH + POLE_HEIGHT / 2),
            cylinder: {
                length: POLE_HEIGHT, topRadius: 1.0, bottomRadius: 1.0,
                material: Cesium.Color.TRANSPARENT, outline: false,
            },
            properties: sharedProps,
        }));

        /* ② 폴 (거리 350m 이내만 표시) */
        const poleEnt = new Cesium.Entity({
            position: pos(lng, lat, baseH + POLE_HEIGHT / 2),
            cylinder: {
                length: POLE_HEIGHT,
                topRadius: POLE_RADIUS,
                bottomRadius: POLE_RADIUS * 1.5,
                material: C_POLE, outline: false,
            },
            properties: sharedProps,
        });
        (poleEnt as any).distanceDisplayCondition =
            new Cesium.DistanceDisplayCondition(0, DIST_POLE);
        this.dataSource.entities.add(poleEnt);

        const hasLeft  = e.leftG.length  > 0;
        const hasRight = e.rightG.length > 0;

        /* ③ 단일 billboard (고정 픽셀, 줌 무관) */
        const canvas = document.createElement("canvas");
        canvas.width  = BB_W;
        canvas.height = BB_H;
        drawFace(canvas, false, false, false, hasLeft ? false : null, hasRight ? false : null);

        const billboard = this.billboardCollection.add({
            position:                 pos(lng, lat, headCtrH),
            image:                    canvas,
            width:                    BB_W,
            height:                   BB_H,
            verticalOrigin:           Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin:         Cesium.HorizontalOrigin.CENTER,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, DIST_SHOW),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        }) as unknown as Cesium.Billboard;

        /* ④ 원거리 "S" 아이콘 billboard (DIST_SHOW 이상) */
        const farBillboard = this.farBillboards.add({
            position:                 pos(lng, lat, headCtrH + 0.5),
            image:                    SIGNAL_ICON,
            width:                    20,
            height:                   20,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(DIST_SHOW, DIST_DOT),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        }) as unknown as Cesium.Billboard;

        this.signalLamps.push({
            nodeId, fromLinkId,
            mainConnGuids: e.mainG, mainConnIds: e.mainI,
            leftConnGuids: e.leftG, leftConnIds: e.leftI,
            rightConnGuids: e.rightG, rightConnIds: e.rightI,
            hasLeft, hasRight,
            canvas, billboard,
            farBillboard,
        });
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.renderInterval !== null) {
            clearInterval(this.renderInterval);
            this.renderInterval = null;
        }
        this.viewer.scene.preRender.removeEventListener(this.onPreRender);
        this.unsubscribes.forEach(u => u());
        this.unsubscribes = [];
        this.viewer.dataSources.remove(this.dataSource, true);
        this.viewer.scene.primitives.remove(this.billboardCollection);
        this.viewer.scene.primitives.remove(this.farBillboards);
    }
}
