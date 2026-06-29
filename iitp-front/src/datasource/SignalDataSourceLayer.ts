import * as Cesium from "cesium";
import { CustomDataSource, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useSignalTimelineStore, SignalTimelineResponse } from "@stores/useSignalTimelineStore";
import { signalRenderState } from "@stores/signalRenderState";
import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import { LOD_ALT, SIGNAL_TILING } from "@utils/lodConstants";
import { SignalTileManager } from "@managers/SignalTileManager";
import { SignalTileMembership } from "@managers/signalTileMembership";
import { useScenarioStore } from "@stores/useScenarioStore";

/* ─────────────────────────────────────────────────────────────────
   LOD 전략 (단순화: 줌아웃 시 크기 고정)
   ① 0 ~ DIST_POLE  : 폴(3D entity) + 신호면 빌보드(고정 픽셀)
   ② 0 ~ DIST_SHOW  : 신호면 빌보드 (단일 고정 픽셀 크기)
   ③ DIST_SHOW ~ DIST_DOT : 컬러 dot (PointPrimitive)
   ────────────────────────────────────────────────────────────── */
const DIST_POLE =   80;                         // 폴 가시 거리 (m)
const DIST_SHOW = LOD_ALT.SIGNAL_BILLBOARD;     // 신호면 billboard 표시 거리 (1200m)
const DIST_DOT  = LOD_ALT.SIGNAL_DOT;           // "S" 아이콘 표시 거리 (4000m)

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

/* ── 3D 실감 모델 치수 (단위: m, DIST_POLE 이내에서만 표시) ── */
const HOUSING_W = 0.32;   // 본체(R/Y/G) 가로
const HOUSING_H = 0.86;   // 본체 세로
const HOUSING_D = 0.18;   // 본체 두께

const LAMP_DIA  = 0.20;   // 메인 램프 지름
const VISOR_W   = 0.26;   // 차양 가로
const VISOR_D   = 0.16;   // 차양 돌출 길이
const VISOR_H   = 0.04;   // 차양 두께

const ARROW_HOUSING_H = 0.30;  // 좌/우회전 보조등 본체 세로
const ARROW_DIA       = 0.16;  // 보조등 램프 지름

/* ── Cesium 색상 ── */
const C_POLE    = Cesium.Color.fromCssColorString("#3c3c3c");
const C_HOUSING = Cesium.Color.fromCssColorString("#1a1c1f");
const C_VISOR   = Cesium.Color.fromCssColorString("#0c0c0f");
const C_RED_ON  = Cesium.Color.fromCssColorString("#ff3333");
const C_RED_OFF = Cesium.Color.fromCssColorString("#3a0a0a");
const C_YEL_ON  = Cesium.Color.fromCssColorString("#ffd700");
const C_YEL_OFF = Cesium.Color.fromCssColorString("#3a3208");
const C_GRN_ON  = Cesium.Color.fromCssColorString("#00e868");
const C_GRN_OFF = Cesium.Color.fromCssColorString("#063018");

function pos(lng: number, lat: number, h: number): Cesium.Cartesian3 {
    return Cesium.Cartesian3.fromDegrees(lng, lat, h);
}
/** 방위각(headingRad, 북=0, 시계방향)으로 distM(m) 만큼 이동한 좌표 */
function fwdOffset(lng: number, lat: number, headingRad: number, distM: number): { lng: number; lat: number } {
    const latRad = lat * Math.PI / 180;
    const dLat = (distM * Math.cos(headingRad)) / 111320;
    const dLng = (distM * Math.sin(headingRad)) / (111320 * Math.cos(latRad));
    return { lng: lng + dLng, lat: lat + dLat };
}
/** headingRad 기준 우측(+90°) 방향으로 distM(m) 만큼 이동한 좌표 */
function lateralOffset(lng: number, lat: number, headingRad: number, distM: number): { lng: number; lat: number } {
    return fwdOffset(lng, lat, headingRad + Math.PI / 2, distM);
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

/**
 * 신호 상태(최대 36가지) → data URL 캐시.
 * toDataURL()은 PNG 인코딩+GPU readback으로 고비용이므로 상태당 1회만 실행.
 */
const _signalImageCache = new Map<string, string>();

function getSignalImageUrl(
    redOn: boolean, yellowOn: boolean, greenOn: boolean,
    leftOn: boolean | null, rightOn: boolean | null,
): string {
    const key = `${+redOn}${+yellowOn}${+greenOn},${leftOn},${rightOn}`;
    let url = _signalImageCache.get(key);
    if (!url) {
        const c = document.createElement("canvas");
        c.width = BB_W; c.height = BB_H;
        drawFace(c, redOn, yellowOn, greenOn, leftOn, rightOn);
        url = c.toDataURL();
        _signalImageCache.set(key, url);
    }
    return url;
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
    billboard:    Cesium.Billboard;
    farBillboard: Cesium.Billboard;
}

/** 모든 신호 위치 데이터 (지형 높이 포함, 메모리에만 보관) */
interface SignalEntry {
    lng: number; lat: number; baseH: number;
    toNodeId: string; fromLinkId: string; signalGuid: string;
    mainG: string[]; mainI: string[];
    leftG: string[]; leftI: string[];
    rightG: string[]; rightI: string[];
    /** 신호면이 바라보는 방위각 (북=0, 시계방향, rad) — 진입 차량 쪽을 향함 */
    headingRad: number;
    /** 피킹 cylinder 중심 Cartesian3 (거리 컬링용) */
    cartesian: Cesium.Cartesian3;
}

/** 근거리(0~DIST_POLE) 3D 실감 모델 — 색상 갱신용 ConstantProperty 보관 */
interface SignalModel3D {
    entities:    Cesium.Entity[];
    redColor:    Cesium.ConstantProperty;
    yellowColor: Cesium.ConstantProperty;
    greenColor:  Cesium.ConstantProperty;
    leftColor?:  Cesium.ConstantProperty;
    rightColor?: Cesium.ConstantProperty;
}

/** 현재 Cesium에 추가된 신호 레코드 */
interface ActiveSignalRecord {
    pickEntity: Cesium.Entity;
    poleEntity: Cesium.Entity;
    lamp:       SignalLamp;
    model3d:    SignalModel3D;
}

/* ─────────────────────────────────────────────────────────────────
   메인 클래스
   ────────────────────────────────────────────────────────────── */
export default class SignalDataSourceLayer {
    private readonly LAYER_NAME = "signal";
    public readonly dataSource:  CustomDataSource;
    private billboardCollection: Cesium.BillboardCollection;
    private farBillboards:       Cesium.BillboardCollection;

    /** 전체 신호 데이터 (Cesium 객체 없음, 메모리만) */
    private allEntries:    SignalEntry[] = [];
    /** key = `${toNodeId}-${fromLinkId}` */
    private activeRecords: Map<string, ActiveSignalRecord> = new Map();
    /** 카메라 컬링 스로틀 타이머 */
    private cullTimer:     ReturnType<typeof setTimeout> | null = null;
    /** camera.changed 리스너 핸들 */
    private onCameraChanged = () => this.scheduleCull();

    private unsubscribes: Array<() => void> = [];
    private lastWallClock = "";
    private renderInterval: ReturnType<typeof setInterval> | null = null;
    private visible    = true;
    private destroyed  = false;
    private needsReload = false;

    // ── 신호 타일링 (SIGNAL_TILING.ENABLED 일 때만; 읽기 전용) ──
    private tileManager: SignalTileManager | null = null;
    private membership = new SignalTileMembership();

    constructor(private viewer: Viewer) {
        this.dataSource = new CustomDataSource(this.LAYER_NAME);
        this.viewer.dataSources.add(this.dataSource);

        this.billboardCollection = new Cesium.BillboardCollection({ scene: this.viewer.scene });
        this.farBillboards       = new Cesium.BillboardCollection({ scene: this.viewer.scene });
        this.viewer.scene.primitives.add(this.billboardCollection);
        this.viewer.scene.primitives.add(this.farBillboards);

        this.load();
        if (SIGNAL_TILING.ENABLED) this.updateTiles(); // 첫 화면 신호 타일 로드
        this.viewer.scene.camera.changed.addEventListener(this.onCameraChanged);
        // preRender(매 프레임) 대신 500ms 인터벌로 신호 색상 갱신 + 렌더 요청
        this.renderInterval = setInterval(() => {
            if (this.activeRecords.size > 0) {
                this.updateSignalColors();
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

    /** 신호 색상 갱신 (500ms 인터벌에서 호출) */
    private updateSignalColors(): void {
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

        for (const { lamp, model3d } of this.activeRecords.values()) {
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

            lamp.billboard.image = getSignalImageUrl(redOn, yellowOn, greenOn, leftOn, rightOn);

            /* 3D 실감 모델 램프 색상 갱신 */
            model3d.redColor.setValue(redOn ? C_RED_ON : C_RED_OFF);
            model3d.yellowColor.setValue(yellowOn ? C_YEL_ON : C_YEL_OFF);
            model3d.greenColor.setValue(greenOn ? C_GRN_ON : C_GRN_OFF);
            model3d.leftColor?.setValue(leftOn ? C_GRN_ON : C_GRN_OFF);
            model3d.rightColor?.setValue(rightOn ? C_GRN_ON : C_GRN_OFF);
        }
    }

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

        /* 기존 Cesium 객체 전부 제거 */
        this.clearAllActive();
        this.allEntries = [];
        this.lastWallClock = "";

        const signalStore = layerNameToStoreMap[this.LAYER_NAME];
        if (!signalStore) return;
        // 타일 모드: viewport 신호만. 비-타일 모드: store 전체.
        const signals: any[] = SIGNAL_TILING.ENABLED
            ? this.membership.values()
            : ((signalStore as any).getState().currentJsonData?.signals ?? []);
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

        const rawEntries: Omit<SignalEntry, 'baseH' | 'cartesian'>[] = [];

        for (const link of networkData.links) {
            const toNodeId = String(link.toNode);
            if (!signalNodeIds.has(toNodeId)) continue;
            if (!link.coordinates?.length) continue;
            const coords = link.coordinates;
            const last = coords[coords.length - 1];
            if (!last) continue;
            const prev = coords.length >= 2 ? coords[coords.length - 2] : last;

            /* 진입 차량 쪽을 향하는 방위각 = 진행 방향(prev→last)의 역방위 */
            let headingRad = 0;
            if (prev && (prev.lng !== last.lng || prev.lat !== last.lat)) {
                const latRad = last.lat * Math.PI / 180;
                const dLng = last.lng - prev.lng;
                const dLat = last.lat - prev.lat;
                headingRad = Math.atan2(dLng * Math.cos(latRad), dLat) + Math.PI;
            }

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
            rawEntries.push({
                lng: last.lng, lat: last.lat, toNodeId, fromLinkId,
                signalGuid: guidMap.get(toNodeId) ?? toNodeId,
                mainG, mainI, leftG, leftI, rightG, rightI,
                headingRad,
            });
        }
        if (!rawEntries.length) return;

        /* 지형 고도 샘플링 (전체 1회, 이후 컬링은 재샘플링 없음) */
        const terrainMap = new Map<string, number>();
        const hasReal = !(this.viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider);
        if (hasReal) {
            const tkey = (lng: number, lat: number) => `${lng.toFixed(5)},${lat.toFixed(5)}`;
            const uk: string[] = [], uc: Cesium.Cartographic[] = [];
            for (const e of rawEntries) {
                const k = tkey(e.lng, e.lat);
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

        const tkey = (lng: number, lat: number) => `${lng.toFixed(5)},${lat.toFixed(5)}`;
        this.allEntries = rawEntries.map(e => {
            const baseH = terrainMap.get(tkey(e.lng, e.lat)) ?? 0;
            return {
                ...e,
                baseH,
                cartesian: Cesium.Cartesian3.fromDegrees(e.lng, e.lat, baseH + POLE_HEIGHT / 2),
            };
        });

        console.log(`SignalDataSourceLayer: ${this.allEntries.length}개 신호등 준비 (초기 컬링 전)`);
        this.updateVisibleSignals();
    }

    /** 카메라 이동 후 200ms 디바운스로 컬링 실행 (+ 타일 모드면 viewport 신호 갱신) */
    private scheduleCull(): void {
        if (this.cullTimer) return;
        this.cullTimer = setTimeout(() => {
            this.cullTimer = null;
            if (SIGNAL_TILING.ENABLED) this.updateTiles();
            this.updateVisibleSignals();
        }, 200);
    }

    /** 카메라 view rect + 고도 → 신호 타일 매니저 갱신 (타일 로드 시 load 재호출) */
    private updateTiles(): void {
        if (!SIGNAL_TILING.ENABLED) return;
        const rect = this.viewer.camera.computeViewRectangle(this.viewer.scene.globe.ellipsoid);
        if (!rect) return;
        const west = Cesium.Math.toDegrees(rect.west);
        const south = Cesium.Math.toDegrees(rect.south);
        const east = Cesium.Math.toDegrees(rect.east);
        const north = Cesium.Math.toDegrees(rect.north);
        if (!this.tileManager) {
            const versionId = useScenarioStore.getState().selectedScenario?.key;
            if (!versionId) return;
            this.tileManager = new SignalTileManager(String(versionId), {
                onTileLoaded: (_k, payload) => { if (this.membership.add(payload)) this.load(); },
                onTileEvicted: (_k, payload) => { if (this.membership.remove(payload)) this.load(); },
            });
        }
        this.tileManager.updateForBbox(west, south, east, north);
    }

    /**
     * 카메라 위치 기준 DIST_DOT 범위 내 신호만 활성화, 범위 밖은 제거.
     * 이미 활성화된 신호는 건드리지 않음 (diff).
     */
    private updateVisibleSignals(): void {
        if (!this.visible || this.allEntries.length === 0) return;

        const camPos = this.viewer.scene.camera.positionWC;
        const radius = DIST_DOT * 1.15;  // 5% 버퍼 (경계 깜빡임 방지)

        const wantKeys = new Set<string>();
        for (const e of this.allEntries) {
            const dx = camPos.x - e.cartesian.x;
            const dy = camPos.y - e.cartesian.y;
            const dz = camPos.z - e.cartesian.z;
            if (dx*dx + dy*dy + dz*dz <= radius * radius) {
                wantKeys.add(`${e.toNodeId}-${e.fromLinkId}`);
            }
        }

        /* 범위 밖으로 나간 것 제거 */
        for (const [key, rec] of this.activeRecords) {
            if (!wantKeys.has(key)) {
                this.dataSource.entities.remove(rec.pickEntity);
                this.dataSource.entities.remove(rec.poleEntity);
                this.billboardCollection.remove(rec.lamp.billboard);
                this.farBillboards.remove(rec.lamp.farBillboard);
                for (const ent of rec.model3d.entities) this.dataSource.entities.remove(ent);
                this.activeRecords.delete(key);
            }
        }

        /* 새로 범위 안에 들어온 것 추가 */
        let added = 0;
        this.dataSource.entities.suspendEvents();
        try {
            for (const e of this.allEntries) {
                const key = `${e.toNodeId}-${e.fromLinkId}`;
                if (wantKeys.has(key) && !this.activeRecords.has(key)) {
                    this.addLight(e);
                    added++;
                }
            }
            if (added > 0) {
                this.billboardCollection.show = this.visible;
                this.farBillboards.show       = this.visible;
                if (this.dataSource.entities.values.length > 0) {
                    this.dataSource.show = this.visible;
                }
            }
        } finally {
            this.dataSource.entities.resumeEvents();
            if (added > 0) {
                try { this.viewer.scene.requestRender(); } catch (_) {}
            }
        }
    }

    /** 모든 활성 신호를 Cesium에서 제거하고 맵을 초기화 */
    private clearAllActive(): void {
        this.dataSource.entities.suspendEvents();
        try {
            this.dataSource.entities.removeAll();
        } finally {
            this.dataSource.entities.resumeEvents();
        }
        this.billboardCollection.removeAll();
        this.farBillboards.removeAll();
        this.activeRecords.clear();
    }

    private addLight(e: SignalEntry): void {
        const { lng, lat, baseH, toNodeId: nodeId, fromLinkId, signalGuid } = e;
        const poleTopH = baseH + POLE_HEIGHT;
        const headCtrH = poleTopH + 0.3;

        const sharedProps = new Cesium.PropertyBag({
            __guid: signalGuid, featureType: "signals", nodeId, fromLinkId,
        });

        /* ① 투명 피커 */
        const pickEntity = this.dataSource.entities.add(new Cesium.Entity({
            id: `signal-pick-${nodeId}-${fromLinkId}`,
            position: pos(lng, lat, baseH + POLE_HEIGHT / 2),
            cylinder: {
                length: POLE_HEIGHT, topRadius: 1.0, bottomRadius: 1.0,
                material: Cesium.Color.TRANSPARENT, outline: false,
            },
            properties: sharedProps,
        }));

        /* ② 폴 */
        const poleEnt = new Cesium.Entity({
            id: `signal-pole-${nodeId}-${fromLinkId}`,
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
        const poleEntity = this.dataSource.entities.add(poleEnt);

        const hasLeft  = e.leftG.length  > 0;
        const hasRight = e.rightG.length > 0;

        /* ③ 근거리 신호면 billboard */
        const billboard = this.billboardCollection.add({
            position:                 pos(lng, lat, headCtrH),
            image:                    getSignalImageUrl(false, false, false, hasLeft ? false : null, hasRight ? false : null),
            width:                    BB_W,
            height:                   BB_H,
            verticalOrigin:           Cesium.VerticalOrigin.BOTTOM,
            horizontalOrigin:         Cesium.HorizontalOrigin.CENTER,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(DIST_POLE, DIST_SHOW),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        }) as unknown as Cesium.Billboard;

        /* ④ 원거리 "S" 아이콘 billboard */
        const farBillboard = this.farBillboards.add({
            position:                 pos(lng, lat, headCtrH + 0.5),
            image:                    SIGNAL_ICON,
            width:                    20,
            height:                   20,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(DIST_SHOW, DIST_DOT),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        }) as unknown as Cesium.Billboard;

        const lamp: SignalLamp = {
            nodeId, fromLinkId,
            mainConnGuids: e.mainG, mainConnIds: e.mainI,
            leftConnGuids: e.leftG, leftConnIds: e.leftI,
            rightConnGuids: e.rightG, rightConnIds: e.rightI,
            hasLeft, hasRight,
            billboard, farBillboard,
        };

        /* ⑤ 근거리(0~DIST_POLE) 3D 실감 모델 */
        const model3d = this.addSignalModel3D(e, poleTopH, hasLeft, hasRight, sharedProps);

        this.activeRecords.set(`${nodeId}-${fromLinkId}`, { pickEntity, poleEntity, lamp, model3d });
    }

    /**
     * 신호등 본체(하우징)·램프(R/Y/G)·차양·좌우회전 보조등을 실감나게 배치한다.
     * headingRad 방향(진입 차량 쪽)을 향하도록 박스를 회전시키고,
     * 그 방향으로 fwdOffset 만큼 이동시켜 하우징 전면에 램프/차양을 배치한다.
     */
    private addSignalModel3D(
        e: SignalEntry, poleTopH: number, hasLeft: boolean, hasRight: boolean,
        sharedProps: Cesium.PropertyBag,
    ): SignalModel3D {
        const { lng, lat, toNodeId: nodeId, fromLinkId, headingRad } = e;
        const entities: Cesium.Entity[] = [];
        const ddc3d = new Cesium.DistanceDisplayCondition(0, DIST_POLE);
        const orientation = Cesium.Transforms.headingPitchRollQuaternion(
            pos(lng, lat, poleTopH), new Cesium.HeadingPitchRoll(headingRad, 0, 0),
        );

        /* 본체(R/Y/G 3구) */
        const housingCtrH = poleTopH + HOUSING_H / 2 + 0.05;
        const housing = new Cesium.Entity({
            id: `signal-housing-${nodeId}-${fromLinkId}`,
            position: pos(lng, lat, housingCtrH),
            orientation,
            box: {
                dimensions: new Cesium.Cartesian3(HOUSING_W, HOUSING_D, HOUSING_H),
                material: C_HOUSING, outline: true,
                outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
            },
            properties: sharedProps,
        });
        (housing as any).distanceDisplayCondition = ddc3d;
        entities.push(this.dataSource.entities.add(housing));

        /* 램프 3구 + 차양 (하우징 전면으로 fwdOffset) */
        const lampFwd  = fwdOffset(lng, lat, headingRad, HOUSING_D / 2 + LAMP_DIA * 0.3);
        const visorFwd = fwdOffset(lng, lat, headingRad, HOUSING_D / 2 + VISOR_D / 2);
        const lampDefs: Array<{ name: string; offsetH: number; defaultColor: Cesium.Color }> = [
            { name: "red",    offsetH:  HOUSING_H / 3, defaultColor: C_RED_OFF },
            { name: "yellow", offsetH:  0,             defaultColor: C_YEL_OFF },
            { name: "green",  offsetH: -HOUSING_H / 3, defaultColor: C_GRN_OFF },
        ];
        const lampColors: Cesium.ConstantProperty[] = [];
        for (const { name, offsetH, defaultColor } of lampDefs) {
            const lampH = housingCtrH + offsetH;
            const colorProp = new Cesium.ConstantProperty(defaultColor);
            lampColors.push(colorProp);

            const lampEnt = new Cesium.Entity({
                id: `signal-lamp-${name}-${nodeId}-${fromLinkId}`,
                position: pos(lampFwd.lng, lampFwd.lat, lampH),
                ellipsoid: {
                    radii: new Cesium.Cartesian3(LAMP_DIA / 2, LAMP_DIA / 2, LAMP_DIA / 2),
                    material: new Cesium.ColorMaterialProperty(colorProp),
                },
                properties: sharedProps,
            });
            (lampEnt as any).distanceDisplayCondition = ddc3d;
            entities.push(this.dataSource.entities.add(lampEnt));

            const visorEnt = new Cesium.Entity({
                id: `signal-visor-${name}-${nodeId}-${fromLinkId}`,
                position: pos(visorFwd.lng, visorFwd.lat, lampH + LAMP_DIA / 2 + VISOR_H / 2),
                orientation,
                box: {
                    dimensions: new Cesium.Cartesian3(VISOR_W, VISOR_D, VISOR_H),
                    material: C_VISOR,
                },
                properties: sharedProps,
            });
            (visorEnt as any).distanceDisplayCondition = ddc3d;
            entities.push(this.dataSource.entities.add(visorEnt));
        }

        /* 좌/우회전 보조등 (본체 하단에 작은 별도 하우징) */
        let leftColor: Cesium.ConstantProperty | undefined;
        let rightColor: Cesium.ConstantProperty | undefined;
        if (hasLeft || hasRight) {
            const arrowCtrH = housingCtrH - HOUSING_H / 2 - 0.06 - ARROW_HOUSING_H / 2;
            const arrowFwd  = fwdOffset(lng, lat, headingRad, HOUSING_D / 2 + ARROW_DIA * 0.3);

            const arrowHousing = new Cesium.Entity({
                id: `signal-arrow-housing-${nodeId}-${fromLinkId}`,
                position: pos(lng, lat, arrowCtrH),
                orientation,
                box: {
                    dimensions: new Cesium.Cartesian3(HOUSING_W, HOUSING_D, ARROW_HOUSING_H),
                    material: C_HOUSING, outline: true,
                    outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
                },
                properties: sharedProps,
            });
            (arrowHousing as any).distanceDisplayCondition = ddc3d;
            entities.push(this.dataSource.entities.add(arrowHousing));

            const both = hasLeft && hasRight;
            if (hasLeft) {
                leftColor = new Cesium.ConstantProperty(C_GRN_OFF);
                const lp = both ? lateralOffset(arrowFwd.lng, arrowFwd.lat, headingRad, -HOUSING_W / 4) : arrowFwd;
                const arrowEnt = new Cesium.Entity({
                    id: `signal-arrow-left-${nodeId}-${fromLinkId}`,
                    position: pos(lp.lng, lp.lat, arrowCtrH),
                    ellipsoid: {
                        radii: new Cesium.Cartesian3(ARROW_DIA / 2, ARROW_DIA / 2, ARROW_DIA / 2),
                        material: new Cesium.ColorMaterialProperty(leftColor),
                    },
                    properties: sharedProps,
                });
                (arrowEnt as any).distanceDisplayCondition = ddc3d;
                entities.push(this.dataSource.entities.add(arrowEnt));
            }
            if (hasRight) {
                rightColor = new Cesium.ConstantProperty(C_GRN_OFF);
                const lp = both ? lateralOffset(arrowFwd.lng, arrowFwd.lat, headingRad, HOUSING_W / 4) : arrowFwd;
                const arrowEnt = new Cesium.Entity({
                    id: `signal-arrow-right-${nodeId}-${fromLinkId}`,
                    position: pos(lp.lng, lp.lat, arrowCtrH),
                    ellipsoid: {
                        radii: new Cesium.Cartesian3(ARROW_DIA / 2, ARROW_DIA / 2, ARROW_DIA / 2),
                        material: new Cesium.ColorMaterialProperty(rightColor),
                    },
                    properties: sharedProps,
                });
                (arrowEnt as any).distanceDisplayCondition = ddc3d;
                entities.push(this.dataSource.entities.add(arrowEnt));
            }
        }

        return {
            entities,
            redColor: lampColors[0]!, yellowColor: lampColors[1]!, greenColor: lampColors[2]!,
            leftColor, rightColor,
        };
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.cullTimer) { clearTimeout(this.cullTimer); this.cullTimer = null; }
        if (this.renderInterval !== null) {
            clearInterval(this.renderInterval);
            this.renderInterval = null;
        }
        this.viewer.scene.camera.changed.removeEventListener(this.onCameraChanged);
        this.tileManager?.clear();
        this.tileManager = null;
        this.unsubscribes.forEach(u => u());
        this.unsubscribes = [];
        this.viewer.dataSources.remove(this.dataSource, true);
        this.viewer.scene.primitives.remove(this.billboardCollection);
        this.viewer.scene.primitives.remove(this.farBillboards);
    }
}
