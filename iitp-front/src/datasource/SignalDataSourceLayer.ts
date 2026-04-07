import * as Cesium from "cesium";
import { CustomDataSource, Viewer } from "cesium";
import { layerNameToStoreMap } from "@hooks/useLayerInit";
import { useNetworkStore } from "@stores/useNetworkStore";
import { useSignalTimelineStore, SignalTimelineResponse } from "@stores/useSignalTimelineStore";
import { signalRenderState } from "@stores/signalRenderState";
import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";

/* ── 치수 ── */
const POLE_HEIGHT  = 5.0;
const POLE_RADIUS  = 0.08;
const HEAD_W       = 0.5;
const HEAD_D       = 0.3;
const HEAD_H       = 1.8;
const LAMP_PX      = 16;
const LAMP_GLOW_PX = 32;
const LAMP_SPACING = HEAD_H / 4;
const ARROW_PX     = 14;   // 화살표 인디케이터 크기

/* ── 거리 기반 LOD ── */
const ENTITY_DIST_COND   = new Cesium.DistanceDisplayCondition(0.0, 300.0);
const LAMP_ALPHA_BY_DIST = new Cesium.NearFarScalar(2000, 1.0, 4000, 0.0);

/* ── 색상 ── */
const C_POLE     = Cesium.Color.fromCssColorString("#424242");
const C_HOUSING  = Cesium.Color.fromCssColorString("#212121");
const C_RED_ON   = Cesium.Color.fromCssColorString("#ff2020");
const C_RED_OFF  = Cesium.Color.fromCssColorString("#5a0000");
const C_YEL_ON   = Cesium.Color.fromCssColorString("#ffee00");
const C_YEL_OFF  = Cesium.Color.fromCssColorString("#5a5a00");
const C_GRN_ON   = Cesium.Color.fromCssColorString("#00ff44");
const C_GRN_OFF  = Cesium.Color.fromCssColorString("#005a00");
const GLOW_ALPHA = 0.25;

function withAlpha(c: Cesium.Color, a: number): Cesium.Color {
    return new Cesium.Color(c.red, c.green, c.blue, a);
}

function toWallClock(jd: Cesium.JulianDate): string {
    const d = Cesium.JulianDate.toDate(jd);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function isoToTime(iso: string): string {
    return iso.substring(11, 19);
}

function pos(lng: number, lat: number, h: number): Cesium.Cartesian3 {
    return Cesium.Cartesian3.fromDegrees(lng, lat, h);
}

/**
 * 링크당 1개 신호등 구조:
 *  - 메인 3색 (red/yellow/green): Straight + UTurn 계열 연결이 활성이면 green
 *  - 좌회전 화살표 인디케이터: Left_Turn 연결이 활성이면 초록 화살표
 *  - 우회전 화살표 인디케이터: Right_Turn 연결이 활성이면 초록 화살표
 */
interface SignalLamp {
    nodeId:     string;
    fromLinkId: string;
    // 메인 신호 (직진 계열)
    mainConnGuids:  string[];
    mainConnIds:    string[];
    // 좌회전 전용
    leftConnGuids:  string[];
    leftConnIds:    string[];
    // 우회전 전용
    rightConnGuids: string[];
    rightConnIds:   string[];
    // 메인 3색 + 글로우
    red:       Cesium.PointPrimitive;
    yellow:    Cesium.PointPrimitive;
    green:     Cesium.PointPrimitive;
    glowRed:   Cesium.PointPrimitive;
    glowGreen: Cesium.PointPrimitive;
    // 화살표 인디케이터 (해당 방향 연결이 없으면 null)
    leftLabel:  Cesium.Label | null;
    rightLabel: Cesium.Label | null;
}

export default class SignalDataSourceLayer {
    private readonly LAYER_NAME = "signal";
    public readonly dataSource: CustomDataSource;
    private lampCollection:  Cesium.PointPrimitiveCollection;
    private labelCollection: Cesium.LabelCollection;
    private signalLamps: SignalLamp[] = [];
    private unsubscribes: Array<() => void> = [];
    private lastWallClock = "";
    private renderInterval: ReturnType<typeof setInterval> | null = null;
    private visible  = true;
    private destroyed = false;

    constructor(private viewer: Viewer) {
        this.dataSource = new CustomDataSource(this.LAYER_NAME);
        this.viewer.dataSources.add(this.dataSource);

        this.lampCollection  = new Cesium.PointPrimitiveCollection();
        this.labelCollection = new Cesium.LabelCollection();
        this.viewer.scene.primitives.add(this.lampCollection);
        this.viewer.scene.primitives.add(this.labelCollection);

        this.load();

        this.viewer.scene.preRender.addEventListener(this.onPreRender);
        this.renderInterval = setInterval(() => {
            if (this.signalLamps.length > 0) {
                try { this.viewer.scene.requestRender(); } catch (_) {}
            }
        }, 500);

        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribes.push(store.subscribe(
                (s: any) => s.currentJsonData,
                () => this.load(),
                { equalityFn: (a: any, b: any) => a === b }
            ));
        }
        this.unsubscribes.push(useNetworkStore.subscribe(
            (s: any) => s.currentJsonData,
            () => this.load(),
            { equalityFn: (a: any, b: any) => a === b }
        ));
        this.unsubscribes.push(useSignalTimelineStore.subscribe(
            (s: any) => s.signalTimeline,
            () => { this.lastWallClock = ""; }
        ));
    }

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

        for (const lamp of this.signalLamps) {
            const state   = nodeState.get(lamp.nodeId);
            const actives = activeConns.get(lamp.nodeId);

            // ── 메인 3색 신호 (직진 계열) ─────────────────────────────
            const mainGuids = lamp.mainConnGuids;
            const mainIds   = lamp.mainConnIds;
            // 직진 연결이 없으면 모든 연결로 fallback
            const allGuids  = [...mainGuids, ...lamp.leftConnGuids, ...lamp.rightConnGuids];
            const allIds    = [...mainIds,   ...lamp.leftConnIds,   ...lamp.rightConnIds];
            const checkMain = mainGuids.length > 0 ? mainGuids : allGuids;
            const checkMainId = mainIds.length > 0 ? mainIds   : allIds;
            const mainGreen = checkMain.some(g => actives?.has(g))
                           || checkMainId.some(id => actives?.has(id));

            if (state === "yellow") {
                lamp.red.color    = C_RED_OFF.clone();
                lamp.yellow.color = C_YEL_ON.clone();
                lamp.green.color  = C_GRN_OFF.clone();
                lamp.glowRed.color   = withAlpha(C_RED_OFF, 0.0);
                lamp.glowGreen.color = withAlpha(C_GRN_OFF, 0.0);
            } else {
                lamp.red.color    = (mainGreen ? C_RED_OFF : C_RED_ON).clone();
                lamp.yellow.color = C_YEL_OFF.clone();
                lamp.green.color  = (mainGreen ? C_GRN_ON  : C_GRN_OFF).clone();
                lamp.glowRed.color   = mainGreen
                    ? withAlpha(C_RED_OFF, 0.0) : withAlpha(C_RED_ON,  GLOW_ALPHA);
                lamp.glowGreen.color = mainGreen
                    ? withAlpha(C_GRN_ON, GLOW_ALPHA) : withAlpha(C_GRN_OFF, 0.0);
            }

            // ── 좌회전 화살표 인디케이터 ──────────────────────────────
            if (lamp.leftLabel) {
                const leftGreen = lamp.leftConnGuids.some(g => actives?.has(g))
                               || lamp.leftConnIds.some(id => actives?.has(id));
                lamp.leftLabel.fillColor = (leftGreen ? C_GRN_ON : C_GRN_OFF).clone();
            }

            // ── 우회전 화살표 인디케이터 ──────────────────────────────
            if (lamp.rightLabel) {
                const rightGreen = lamp.rightConnGuids.some(g => actives?.has(g))
                                || lamp.rightConnIds.some(id => actives?.has(id));
                lamp.rightLabel.fillColor = (rightGreen ? C_GRN_ON : C_GRN_OFF).clone();
            }
        }
    };

    public setVisible(visible: boolean): void {
        this.visible = visible;
        this.dataSource.show      = visible;
        this.lampCollection.show  = visible;
        this.labelCollection.show = visible;
    }

    public load(): void {
        const drawStore = useNetworkDrawStore.getState();
        if (drawStore.isActive || drawStore.isConnectionActive) return;

        this.lampCollection.removeAll();
        this.labelCollection.removeAll();
        this.signalLamps = [];
        this.lastWallClock = "";

        this.dataSource.entities.suspendEvents();
        try {
            this.dataSource.entities.removeAll();

            const signalStore = layerNameToStoreMap[this.LAYER_NAME];
            if (!signalStore) return;

            const signals: any[] = signalStore.getState().currentJsonData?.signals ?? [];
            if (!signals.length) return;

            const networkData = useNetworkStore.getState().currentJsonData;
            if (!networkData?.nodes || !networkData?.links) return;

            const signalNodeIds = new Set(signals.map((s: any) => String(s.nodeId)));
            const nodeConnectionMap = new Map<string, any[]>();
            for (const node of networkData.nodes) {
                nodeConnectionMap.set(String(node.id), node.connections ?? []);
            }

            for (const link of networkData.links) {
                const toNodeId = String(link.toNode);
                if (!signalNodeIds.has(toNodeId)) continue;
                if (!link.coordinates?.length) continue;

                const lastCoord = link.coordinates[link.coordinates.length - 1];
                if (!lastCoord) continue;

                const fromLinkId = String(link.id);
                const conns = nodeConnectionMap.get(toNodeId) ?? [];

                // 방향별 conn 분류
                const mainConnGuids:  string[] = [];
                const mainConnIds:    string[] = [];
                const leftConnGuids:  string[] = [];
                const leftConnIds:    string[] = [];
                const rightConnGuids: string[] = [];
                const rightConnIds:   string[] = [];

                for (const conn of conns) {
                    if (String(conn.fromLink) !== fromLinkId) continue;
                    const t = conn.turning ? String(conn.turning) : "Straight";
                    const guid = conn.__guid ?? String(conn.id);
                    const id   = String(conn.id);
                    if (t === "Left_Turn" || t === "Left") {
                        leftConnGuids.push(guid); leftConnIds.push(id);
                    } else if (t === "Right_Turn" || t === "Right") {
                        rightConnGuids.push(guid); rightConnIds.push(id);
                    } else {
                        // Straight, UTurn, 기타 → 메인 신호
                        mainConnGuids.push(guid); mainConnIds.push(id);
                    }
                }

                this.addTrafficLight(
                    lastCoord.lng, lastCoord.lat, toNodeId, fromLinkId,
                    mainConnGuids, mainConnIds,
                    leftConnGuids, leftConnIds,
                    rightConnGuids, rightConnIds
                );
            }

            this.lampCollection.show  = this.visible;
            this.labelCollection.show = this.visible;
            if (this.dataSource.entities.values.length > 0) {
                this.dataSource.show = this.visible;
            }
            console.log(`SignalDataSourceLayer: ${this.signalLamps.length}개 신호등 로드`);
        } catch (err) {
            console.error("SignalDataSourceLayer.load() 에러:", err);
        } finally {
            this.dataSource.entities.resumeEvents();
            try { this.viewer.scene.requestRender(); } catch (_) {}
        }
    }

    private addTrafficLight(
        lng: number, lat: number,
        nodeId: string, fromLinkId: string,
        mainConnGuids: string[], mainConnIds: string[],
        leftConnGuids: string[], leftConnIds: string[],
        rightConnGuids: string[], rightConnIds: string[]
    ): void {
        const housingCenter = POLE_HEIGHT + HEAD_H / 2;
        const redH    = housingCenter + LAMP_SPACING;
        const yellowH = housingCenter;
        const greenH  = housingCenter - LAMP_SPACING;
        // 화살표 인디케이터 높이: 메인 신호 바로 아래
        const arrowH  = greenH - LAMP_SPACING;

        /* ① 폴 */
        const poleEntity = new Cesium.Entity({
            position: pos(lng, lat, POLE_HEIGHT / 2),
            cylinder: {
                length: POLE_HEIGHT, topRadius: POLE_RADIUS,
                bottomRadius: POLE_RADIUS, material: C_POLE, outline: false,
            },
        });
        (poleEntity as any).distanceDisplayCondition = ENTITY_DIST_COND;
        this.dataSource.entities.add(poleEntity);

        /* ② 하우징 */
        const housingEntity = new Cesium.Entity({
            position: pos(lng, lat, housingCenter),
            box: {
                dimensions: new Cesium.Cartesian3(HEAD_W, HEAD_D, HEAD_H),
                material: C_HOUSING, outline: false,
            },
        });
        (housingEntity as any).distanceDisplayCondition = ENTITY_DIST_COND;
        this.dataSource.entities.add(housingEntity);

        /* ③ 메인 3색 램프 + 글로우 */
        const lampOpts = (h: number, color: Cesium.Color) => ({
            position: pos(lng, lat, h), color: color.clone(),
            pixelSize: LAMP_PX,
            translucencyByDistance: LAMP_ALPHA_BY_DIST,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
        const glowOpts = (h: number, color: Cesium.Color) => ({
            position: pos(lng, lat, h), color: withAlpha(color, 0.0),
            pixelSize: LAMP_GLOW_PX,
            translucencyByDistance: LAMP_ALPHA_BY_DIST,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });

        const red      = this.lampCollection.add(lampOpts(redH,    C_RED_OFF));
        const yellow   = this.lampCollection.add(lampOpts(yellowH, C_YEL_OFF));
        const green    = this.lampCollection.add(lampOpts(greenH,  C_GRN_OFF));
        const glowRed  = this.lampCollection.add(glowOpts(redH,    C_RED_OFF));
        const glowGreen= this.lampCollection.add(glowOpts(greenH,  C_GRN_OFF));

        /* ④ 화살표 인디케이터 (좌/우회전이 있는 경우만) */
        const arrowLabelOpts = (text: string, offsetX: number): Cesium.Label => {
            return this.labelCollection.add({
                position:                 pos(lng, lat, arrowH),
                text,
                font:                     `bold ${ARROW_PX}px sans-serif`,
                fillColor:                C_GRN_OFF.clone(),  // 초기: 꺼진 상태
                outlineColor:             Cesium.Color.BLACK,
                outlineWidth:             2,
                style:                    Cesium.LabelStyle.FILL_AND_OUTLINE,
                horizontalOrigin:         Cesium.HorizontalOrigin.CENTER,
                verticalOrigin:           Cesium.VerticalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                translucencyByDistance:   LAMP_ALPHA_BY_DIST,
                pixelOffset:              new Cesium.Cartesian2(offsetX, 0),
            }) as unknown as Cesium.Label;
        };

        const leftLabel  = leftConnGuids.length  > 0 ? arrowLabelOpts("←", -18) : null;
        const rightLabel = rightConnGuids.length > 0 ? arrowLabelOpts("→",  18) : null;

        this.signalLamps.push({
            nodeId, fromLinkId,
            mainConnGuids, mainConnIds,
            leftConnGuids, leftConnIds,
            rightConnGuids, rightConnIds,
            red, yellow, green, glowRed, glowGreen,
            leftLabel, rightLabel,
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
        this.viewer.scene.primitives.remove(this.lampCollection);
        this.viewer.scene.primitives.remove(this.labelCollection);
    }
}
