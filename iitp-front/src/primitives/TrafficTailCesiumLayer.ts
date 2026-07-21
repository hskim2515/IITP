import * as Cesium from "cesium";
import { getActiveVersionId } from "@utils/versionId";
import { useSimulationStore } from "@stores/useSimulationStore";
import { TRAFFIC_FLOW } from "@utils/lodConstants";
import { computeViewportMetrics } from "@utils/viewportMetrics";
import axiosInstance from "@api/axiosInstance";
import { JulianDate } from "cesium";

/** volume(밀도) 버킷 개수 — 0(안 보임) 제외 */
const NUM_FLOW_BUCKETS = 4;
/** 버킷별 선 두께(px) */
// 원거리(pixelSizeM 최대 200)에서도 눈에 띄도록 넉넉하게 — GroundPolylineGeometry width는
// 화면 픽셀 단위라 줌아웃해도 얇아지진 않지만, 애초에 너무 얇으면 원거리에서 잘 안 보인다.
const BUCKET_WIDTHS = [6, 9, 13, 18];
/** 버킷별 기본 색상 (저밀도→고밀도) */
const BUCKET_COLORS = ["#3aa0ff", "#ffd23a", "#ff8a3a", "#ff3a3a"];
/** avgSpeed(km/h) 정규화 상한 — 이 이상은 애니메이션 속도를 더 올리지 않고 클램프 */
const MAX_SPEED_KMH = 80;
/** 애니메이션 최소 속도 배율(정체 구간도 흐름이 아예 안 보이진 않게) */
const MIN_SPEED_FACTOR = 0.15;
/** volume 최소값 — 이 미만인 링크는 그리지 않음(성능/노이즈 억제) */
const MIN_VISIBLE_VOLUME = 1;
/** 재빌드 최소 간격 (ms) */
const REBUILD_MIN_MS = 2000;

const FLOW_MATERIAL_TYPE = "TrafficFlowDash";

function flowColor(bucket: number): Cesium.Color {
    const hex = BUCKET_COLORS[bucket - 1] ?? "#ff3a3a";
    return Cesium.Color.fromCssColorString(hex).withAlpha(0.85);
}

/** 버킷별 애니메이션 흐름 Material — st.s(링크를 따라가는 좌표)를 시간에 따라 스크롤해 점선이 흐르는 것처럼 보이게 한다 */
function createFlowMaterial(color: Cesium.Color, speedFactor: number): Cesium.Material {
    return new Cesium.Material({
        fabric: {
            type: FLOW_MATERIAL_TYPE,
            uniforms: {
                color,
                time: 0.0,
                speed: speedFactor,
            },
            source: `
                czm_material czm_getMaterial(czm_materialInput materialInput) {
                    czm_material material = czm_getDefaultMaterial(materialInput);
                    float s = materialInput.st.s;
                    // 원거리에서 링크 하나가 화면상 짧게 보일 때 대시가 너무 잘게 쪼개지면
                    // 안 보인다 — 대시 수를 줄여 하나하나가 크게 보이도록 조정.
                    float dashScale = 6.0;
                    float t = fract(s * dashScale - time * speed);
                    float dash = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.32, 0.44, t));
                    material.diffuse = color.rgb;
                    material.alpha = color.a * dash;
                    return material;
                }
            `,
        },
        translucent: true,
    });
}

/**
 * 교통 흐름(flow) tail — 개별 차량(3D)과 히트맵 사이의 중간 줌 티어 Cesium 레이어.
 *
 * 데이터는 TrafficHeatmapCesiumLayer의 백엔드 집계 모드와 완전히 동일한 방식(카메라 중앙
 * 지면점 기준 bbox + 재생 시각 기준 시간창으로 `/analytics/link-traffic` 호출)을 그대로
 * 재사용한다 — 개별 차량 fetch가 아니라 SQLite GROUP BY 집계라 뷰포트가 커져도 백엔드 비용이
 * 늘지 않는다(TrafficHeatmapCesiumLayer와 동일 이유로 이 방식을 선택). 렌더링만 달라서,
 * 히트맵은 링크를 정적 색상/굵기로 칠하고, 여기서는 volume(밀도)로 버킷을 나누고 avgSpeed로
 * 애니메이션 속도를 조절해 링크를 따라 흐르는 점선으로 표현한다.
 */
export default class TrafficTailCesiumLayer {
    layer      = "";
    layerGroup = "";
    destroyed  = false;

    private _show = false;
    private _scene: Cesium.Scene;
    private _viewer: Cesium.Viewer;

    /** linkId → 최신 집계(volume/avgSpeed/좌표) */
    private _linkAgg = new Map<string, { volume: number; avgSpeed: number; positions: Cesium.Cartesian3[] }>();

    private _bucketPrimitives: (Cesium.GroundPolylinePrimitive | null)[] =
        new Array(NUM_FLOW_BUCKETS + 1).fill(null);
    private _bucketMaterials: (Cesium.Material | null)[] =
        new Array(NUM_FLOW_BUCKETS + 1).fill(null);

    private _needsRebuild = false;
    private _lastRebuildTime = 0;
    private _animStart = performance.now();

    // ── 줌(pixelSize) 기반 활성 여부 — TrafficHeatmapCesiumLayer의 근/원거리 전환과 동일 패턴 ──
    private _active = false;
    private _lastAggregateAt = 0;
    private _camUnsub: (() => void) | null = null;
    private _simUnsub: (() => void) | null = null;
    private _scheduleTimer: ReturnType<typeof setTimeout> | null = null;

    get show() { return this._show; }
    set show(val: boolean) {
        this._show = val;
        for (const p of this._bucketPrimitives) {
            if (p) p.show = val;
        }
    }

    constructor(viewer: Cesium.Viewer) {
        this._scene = viewer.scene;
        this._viewer = viewer;

        if (!TRAFFIC_FLOW.ENABLED) return;

        // ⚠️ camera.changed는 렌더 루프 안에서 발화 — globe.pick 등을 동기 호출하면 렌더 중
        // 예외로 이어져 렌더링이 멈출 수 있다. setTimeout으로 렌더 루프 밖에서 실행
        // (NetworkDataSourceLayer/TrafficHeatmapCesiumLayer와 동일 패턴).
        const onCam = () => this._schedule();
        viewer.camera.changed.addEventListener(onCam);
        this._camUnsub = () => viewer.camera.changed.removeEventListener(onCam);
        this._simUnsub = (useSimulationStore as any).subscribe(
            (s: any) => s.currentTime,
            () => this._schedule(),
        );
        this._schedule();
    }

    private _schedule(): void {
        if (this._scheduleTimer) return;
        this._scheduleTimer = setTimeout(() => {
            this._scheduleTimer = null;
            try { this._updateAggregation(); }
            catch (e) { console.warn('[TrafficTailCesium] 집계 갱신 실패 (무시):', e); }
        }, 250);
    }

    /** 화면 중앙 지면점 기준 bbox + 재생 시간창으로 집계 fetch (computeViewportMetrics 공용 유틸 사용) */
    private _updateAggregation(): void {
        if (!TRAFFIC_FLOW.ENABLED || this.destroyed) return;

        const metrics = computeViewportMetrics(this._viewer);
        if (!metrics) { this._setActive(false); return; }
        const { normalizedPixelSizeM, bbox } = metrics;

        // 개별 차량 3D 구간(너무 확대)과 히트맵 구간(너무 축소) 사이에서만 활성.
        // normalizedPixelSizeM 사용 — 네트워크 실제 크기(부천 규모/광역 등) 대비 상대적 줌 단계로 판정.
        const active = normalizedPixelSizeM >= TRAFFIC_FLOW.MIN_RESOLUTION && normalizedPixelSizeM < TRAFFIC_FLOW.MAX_RESOLUTION;
        console.log('[진단][TrafficTail] normalizedPixelSizeM=', normalizedPixelSizeM.toFixed(2), 'active=', active,
            `(범위 ${TRAFFIC_FLOW.MIN_RESOLUTION}~${TRAFFIC_FLOW.MAX_RESOLUTION})`);
        this._setActive(active);
        if (!active) return;

        const now = performance.now();
        if (now - this._lastAggregateAt < TRAFFIC_FLOW.THROTTLE_MS) return;
        this._lastAggregateAt = now;

        const versionId = getActiveVersionId();
        if (!versionId) { console.warn('[진단][TrafficTail] versionId 없음 — fetch 생략'); return; }

        const { w, s, e, n } = bbox;
        const { fromTime, toTime } = this._timeWindow();

        console.log('[진단][TrafficTail] link-traffic 호출', { versionId, bbox: `${w},${s},${e},${n}`, fromTime, toTime });
        axiosInstance.get(`/analytics/link-traffic/${versionId}`, {
            params: { bbox: `${w},${s},${e},${n}`, fromTime, toTime },
        }).then((res) => {
            if (this.destroyed) return;
            const links = res.data?.links ?? [];
            this._linkAgg.clear();
            for (const lt of links) {
                if (!Array.isArray(lt.coordinates) || lt.coordinates.length < 2) continue;
                if ((lt.volume ?? 0) < MIN_VISIBLE_VOLUME) continue;
                this._linkAgg.set(String(lt.linkId), {
                    volume: lt.volume ?? 0,
                    avgSpeed: lt.avgSpeed ?? 0,
                    positions: lt.coordinates.map((c: any) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat)),
                });
            }
            console.log('[진단][TrafficTail] 응답 links=', links.length, '유효(volume/좌표 있음)=', this._linkAgg.size);
            this._needsRebuild = true;
        }).catch((err) => {
            console.warn('[진단][TrafficTail] 집계 호출 실패', err?.response?.status, err);
        });
    }

    private _setActive(active: boolean): void {
        if (this._active === active) return;
        this._active = active;
        this.show = active;
        if (!active) this._linkAgg.clear();
    }

    /** 재생 현재 시각 기준 ± 집계 시간창 (TrafficHeatmapCesiumLayer._timeWindow와 동일) */
    private _timeWindow(): { fromTime: number; toTime: number } {
        const sim = useSimulationStore.getState() as any;
        const cur = sim.currentTime;
        const start = sim.startTime ?? sim.simStartTime;
        if (!cur || !start) return { fromTime: 0, toTime: 0 };
        try {
            const sec = Math.round(JulianDate.secondsDifference(cur, start));
            const half = TRAFFIC_FLOW.TIME_WINDOW_SEC;
            return { fromTime: Math.max(0, sec - half), toTime: sec + half };
        } catch {
            return { fromTime: 0, toTime: 0 };
        }
    }

    private _rebuildPrimitives() {
        // 버킷별: { positions[], speedSum, speedCount } — 버킷의 평균 속도로 애니메이션 속도 결정
        const bucketData: { positions: Cesium.Cartesian3[][]; speedSum: number; count: number }[] =
            Array.from({ length: NUM_FLOW_BUCKETS + 1 }, () => ({ positions: [], speedSum: 0, count: 0 }));

        const maxVolume = Math.max(1, ...Array.from(this._linkAgg.values()).map(a => a.volume));
        for (const agg of this._linkAgg.values()) {
            const ratio = agg.volume / maxVolume;
            const bucket = ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
            bucketData[bucket]!.positions.push(agg.positions);
            bucketData[bucket]!.speedSum += agg.avgSpeed;
            bucketData[bucket]!.count += 1;
        }

        for (let b = 1; b <= NUM_FLOW_BUCKETS; b++) {
            const old = this._bucketPrimitives[b];
            if (old && !old.isDestroyed()) this._scene.primitives.remove(old);
            this._bucketPrimitives[b] = null;
            this._bucketMaterials[b] = null;

            const data = bucketData[b]!;
            if (data.positions.length === 0) continue;

            const avgSpeed = data.count > 0 ? data.speedSum / data.count : 0;
            const speedFactor = Math.max(MIN_SPEED_FACTOR, Math.min(1, avgSpeed / MAX_SPEED_KMH));
            const material = createFlowMaterial(flowColor(b), speedFactor);
            this._bucketMaterials[b] = material;

            const instances = data.positions.map(positions =>
                new Cesium.GeometryInstance({
                    geometry: new Cesium.GroundPolylineGeometry({ positions, width: BUCKET_WIDTHS[b - 1] ?? 5 }),
                })
            );

            const primitive = new Cesium.GroundPolylinePrimitive({
                geometryInstances: instances,
                appearance: new Cesium.PolylineMaterialAppearance({ material }),
                show: this._show,
            });
            this._scene.primitives.add(primitive);
            this._bucketPrimitives[b] = primitive;
        }
        console.log('[진단][TrafficTail] 재빌드 완료 — 버킷별 링크 수:',
            bucketData.slice(1).map((d, i) => `b${i + 1}=${d.positions.length}`).join(' '),
            'show=', this._show);
    }

    // ── 외부 인터페이스 (개별 차량 위치는 사용하지 않음 — 항상 집계 기반) ──────────
    public setLatestPositions(_data: { positions: (number[] | null)[] }) {}
    public setSpeed(_v: number) {}
    public setStatus(_s: any) {}

    // ── update (PrimitiveCollection이 매 프레임 호출) ────────────────
    update(_frameState: any) {
        if (this.destroyed || !TRAFFIC_FLOW.ENABLED) return;

        const now = Date.now();
        if (this._needsRebuild && now - this._lastRebuildTime >= REBUILD_MIN_MS) {
            try {
                this._rebuildPrimitives();
            } catch (e) {
                console.warn('[TrafficTailCesium] 재빌드 실패 (무시):', e);
            }
            this._lastRebuildTime = now;
            this._needsRebuild = false;
        }

        if (!this._active) return;

        // 애니메이션 시간 갱신 — 렌더 루프에서 매 프레임 uniform만 갱신(재빌드 아님, 저비용)
        const t = (performance.now() - this._animStart) / 1000;
        for (const material of this._bucketMaterials) {
            if (material) material.uniforms.time = t;
        }
    }

    public destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this._camUnsub?.();
        this._simUnsub?.();
        if (this._scheduleTimer) { clearTimeout(this._scheduleTimer); this._scheduleTimer = null; }
        this._linkAgg.clear();
        for (let b = 1; b <= NUM_FLOW_BUCKETS; b++) {
            const p = this._bucketPrimitives[b];
            if (p && !p.isDestroyed()) this._scene.primitives.remove(p);
        }
        this._bucketPrimitives = new Array(NUM_FLOW_BUCKETS + 1).fill(null);
        this._bucketMaterials = new Array(NUM_FLOW_BUCKETS + 1).fill(null);
    }
}
