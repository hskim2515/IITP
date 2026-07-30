import * as Cesium from "cesium";
import { getActiveVersionId } from "@utils/versionId";
import { useSimulationStore } from "@stores/useSimulationStore";
import { useVehicleStore } from "@stores/useVehicleStore";
import { VEHICLE_AGG_FEED } from "@utils/lodConstants";
import { computeViewportMetrics } from "@utils/viewportMetrics";
import axiosInstance from "@api/axiosInstance";
import { JulianDate } from "cesium";

interface SyntheticVehicle {
    /** 소속 링크 — 집계 갱신 시 같은 링크가 유지되면 슬롯/진행도(t)를 보존해 trail 연속성 유지 */
    linkId: string;
    coords: Cesium.Cartesian3[];
    cum: number[];
    total: number;
    t: number;
    speed: number; // m/s
}

/** 합성 차량 전체 상한 — useSimulation.ts의 초기 addTripLayer() 더미 배열 크기와 반드시 동일해야
 *  함(VEHICLE_AGG_FEED.MAX_SYNTHETIC_VEHICLES 참고, TailPrimitive는 trail 슬롯을 미리 고정 할당). */
const MAX_SYNTHETIC_TOTAL = VEHICLE_AGG_FEED.MAX_SYNTHETIC_VEHICLES;
/** 정체 링크(avgSpeed≈0)도 최소한의 흐름감이 있도록 하는 최저 속도 */
const MIN_SPEED_MS = 2;
/**
 * avgSpeed 데이터가 없을 때("모름") 쓸 중립 대체값(km/h) — 현재 운영 스키마(VehicleEvent)에는
 * spd 컬럼이 없어 `/analytics/link-traffic`의 avgSpeed가 **항상 0.0**으로 내려온다(null/undefined
 * 아님). 예전 코드는 `lt.avgSpeed ?? 20`으로 null만 잡았는데 avgSpeed가 진짜 숫자 0이라 이 폴백이
 * 한 번도 안 걸리고 항상 MIN_SPEED_MS(2m/s)로 떨어져, volume>0인 링크는 무조건 "정체"(빨강)로
 * 보였다 — 실제 그 순간 화면에 차량이 없어도 마찬가지였다(실사용 보고: "차량이 없는데도
 * 빨간색으로 히트맵이 나옴"). "데이터 없음"을 최악(정체)이 아니라 중립(SPEED_FREE_FLOW의 절반
 * 정도)으로 해석하도록 바꾼다 — 실제 속도를 아는 게 아니므로 어느 쪽으로도 과장하지 않는다.
 */
const UNKNOWN_SPEED_KMH = 36; // ≈ SPEED_FREE_FLOW(20m/s)의 절반 — 색상 스케일 중간(노랑 부근)
/**
 * 링크 위 합성 차량 간 목표 간격(m). HeatBarLayer의 grid cell(100m)보다 좁게 잡아, exaggeration이
 * 높아 falloff 반경이 0(해당 셀 하나만)이 되는 경우에도 연속한 두 합성 차량의 커버 셀이 항상
 * 이어지거나 겹치도록 한다 — 그래야 차량들이 다 같이 이동해도 지나간 자리 사이에 완전히 빈
 * 셀(즉시 어두워졌다 다음 차량이 올 때 다시 밝아지는 깜빡임)이 생기지 않는다.
 */
const COVERAGE_SPACING_M = 80;
/**
 * volume(그 링크를 최근 시간창 안에 지나간 차량 수) 기반 밀도 배율의 상한. 배율이 없으면
 * volume이 1이든 50이든 desiredCount가 링크 길이만으로 정해져 똑같이 "빈틈없이 채워진" 최대
 * 밀도로 보인다 — HeatBarLayer 색상은 그리드 전체 상대 최댓값 대비 정규화라, 한 프레임에
 * volume이 다른 링크들이 섞여 있어도 전부 새빨갛게 뜨는 문제가 있었다(실측 보고: "차량이 안
 * 보이는 곳도 빨갛게 나옴" — 지나간 지 얼마 안 된 차량 1대짜리 링크가 정체 링크와 똑같이
 * 보임). 상한을 두는 이유는 volume이 매우 큰 링크 하나가 전체 예산(MAX_SYNTHETIC_TOTAL)을
 * 독식해 다른 링크들이 배분받는 대수가 과도하게 줄어드는 것을 막기 위함.
 */
const VOLUME_DENSITY_MAX_MULTIPLIER = 6;

/**
 * 개별 차량(3D)이 감당 안 되는 원거리 줌에서, 기존 "heatmap"(HeatBarLayer/HeatmapFeatureLayer,
 * 그리드 밀도)과 "trip"(TailPrimitive, 개별 꼬리 흔적) 분석 레이어를 계속 살려두기 위한 데이터
 * 공급기.
 *
 * 새 렌더러를 만드는 대신, `/analytics/link-traffic` 집계(링크별 volume/avgSpeed — SQLite
 * GROUP BY, 개별 차량 무관 비용)를 받아 각 링크 위를 흐르는 "합성 차량" 위치를 계산하고,
 * 기존 두 레이어가 원래 쓰던 것과 동일한 인터페이스(`setLatestPositions({positions})`)로
 * 그대로 먹인다 — heatmap/trip 렌더러 자체는 전혀 손대지 않는다.
 *
 * 이 스트리밍이 멈추는 원거리(정규화 pixelSizeM이 VEHICLE_STREAMING.MAX_PIXEL_SIZE_M 이상)
 * 부터 활성화되고, VEHICLE_AGG_FEED.MAX_RESOLUTION 이상(더 축소)이면 OD_FLOW(OdFlowCesiumLayer)
 * 로 넘어가므로 다시 비활성화된다. 카메라/재생시각 변화에 자체 반응(TrafficHeatmapCesiumLayer 등과
 * 동일 패턴) — 외부에서 매 setSimulation()마다 재생성할 필요 없이 한 번만 생성해 계속 산다.
 */
export default class VehicleAggregationFeeder {
    private destroyed = false;
    private active = false;
    /**
     * 합성 차량 슬롯 — 길이가 MAX_SYNTHETIC_TOTAL로 **고정**된 배열(빈 자리는 null).
     *
     * ⚠️ 왜 인덱스가 안정적이어야 하는가: TailPrimitive(trip)는 positions[i]를 자기 i번째 trail
     * 버퍼에 이어붙이는 인덱스 결합 구조이고, 순간이동 리셋 기준(MAX_JUMP_SQ)이 10km라 그보다
     * 짧은 점프는 전부 직선 띠로 이어 그린다. 예전처럼 집계 갱신(~1초)마다 배열을 통째로
     * 재생성하면 슬롯 i가 매번 다른 링크의 차량으로 바뀌어 — 화면을 가로지르는 줄무늬가 1초마다
     * 다시 그려졌다("트립플로우가 이상함"의 주범 중 하나). 같은 링크가 유지되는 동안 그 차량은
     * 같은 슬롯에 같은 진행도로 남긴다.
     */
    private slots: (SyntheticVehicle | null)[] = new Array(MAX_SYNTHETIC_TOTAL).fill(null);
    /** heatmap용 정적 스냅샷(rebuildSyntheticVehicles에서만 갱신) — tick()이 계속 재공급해 decay로
     *  서서히 꺼지는 것을 막는다. 아래 rebuildSyntheticVehicles/tick 주석 참고. */
    private staticHeatPositions: number[][] = [];

    private lastAggregateAt = 0;
    private lastTickAt = performance.now();
    private camUnsub: (() => void) | null = null;
    private simUnsub: (() => void) | null = null;
    private denseUnsub: (() => void) | null = null;
    private scheduleTimer: ReturnType<typeof setTimeout> | null = null;
    private tickTimer: ReturnType<typeof setInterval> | null = null;

    constructor(private viewer: Cesium.Viewer, private layerManager: any) {
        if (!VEHICLE_AGG_FEED.ENABLED) return;

        // ⚠️ camera.changed는 렌더 루프 안에서 발화 — globe.pick 등을 동기 호출하면 렌더 중
        // 예외로 이어져 렌더링이 멈출 수 있다. setTimeout으로 렌더 루프 밖에서 실행
        // (NetworkDataSourceLayer와 동일 패턴).
        const onCam = () => this.schedule();
        viewer.camera.changed.addEventListener(onCam);
        this.camUnsub = () => viewer.camera.changed.removeEventListener(onCam);
        this.simUnsub = (useSimulationStore as any).subscribe(
            (s: any) => s.currentTime,
            () => this.schedule(),
        );
        // denseViewport(뷰포트 차량 수 상한 초과로 개별 차량 표시를 끈 상태) — 예전에는 별도의
        // "traffic"(링크 색칠) 레이어가 이 조건에서 자체적으로 나타났으나, 사용자가 거부한 링크
        // 기반 시각화였다. heatmap/trip으로 통일 — dense여도 이 피더가 계속 데이터를 공급한다.
        // ⚠️ useVehicleStore는 subscribeWithSelector 미들웨어가 없어(useSimulationStore와 다름)
        // selector 오버로드(subscribe(selector, listener))를 지원하지 않는다 — 그 형태로 호출하면
        // 조용히 아무 효과 없는 구독이 된다. 수동으로 이전 값과 비교해 변화만 감지.
        let lastDense = (useVehicleStore.getState() as any).denseViewport === true;
        this.denseUnsub = useVehicleStore.subscribe((state: any) => {
            const dense = state.denseViewport === true;
            if (dense !== lastDense) {
                lastDense = dense;
                this.schedule();
            }
        });
        this.schedule();

        // 합성 차량 이동 틱 — 실제 차량 tick(50ms)과 비슷한 주기로 heatmap/trip에 위치 공급
        this.tickTimer = setInterval(() => this.tick(), 80);
    }

    private schedule(): void {
        if (this.scheduleTimer) return;
        this.scheduleTimer = setTimeout(() => {
            this.scheduleTimer = null;
            try { this.updateAggregation(); }
            catch (e) { console.warn('[VehicleAggregationFeeder] 집계 갱신 실패 (무시):', e); }
        }, 250);
    }

    private updateAggregation(): void {
        if (!VEHICLE_AGG_FEED.ENABLED || this.destroyed) return;

        const metrics = computeViewportMetrics(this.viewer);
        if (!metrics) { this.setActive(false); return; }
        const { normalizedPixelSizeM, bbox } = metrics;

        // 활성 = "데이터 공급원 전환" 기준일 뿐, 레이어 표시 여부와 무관하다 — 표시는 분석 메뉴
        // 온오프(사용자)가 전적으로 결정한다. MIN_RESOLUTION 미만(근거리)은 실차량 worker feed가
        // heatmap/trip을 담당하고, 그 이상(원거리)은 이 피더의 집계 기반 합성 위치가 담당한다.
        // 상한 없음 — 아무리 축소해도 사용자가 켜둔 heatmap/trip은 계속 데이터를 받는다(bbox가
        // 커질수록 링크 수가 늘어 예산(scale)이 자동으로 좁혀지므로 세밀도만 거칠어진다).
        // dense(뷰포트 차량 수 상한 초과)면 줌 무관 활성 — 개별 차량 데이터가 없으니 집계가 대체.
        const dense = (useVehicleStore.getState() as any).denseViewport === true;
        // 히스테리시스 — 카메라가 경계(MIN_RESOLUTION) 부근에 있으면 진단 로그에서 확인된 것처럼
        // normalizedPixelSizeM이 7↔15를 오가며 몇 초마다 활성이 토글되고, 그때마다 heatmap/trip의
        // 데이터 공급원이 합성↔실차량으로 통째로 스왑되어 시각적 혼란(리셋/재구축 반복)이 생긴다.
        // 켤 때는 경계의 1.2배 이상, 끌 때는 0.8배 미만 — 그 사이 구간에선 현 상태 유지.
        const zoomOn  = normalizedPixelSizeM >= VEHICLE_AGG_FEED.MIN_RESOLUTION * 1.2;
        const zoomOff = normalizedPixelSizeM <  VEHICLE_AGG_FEED.MIN_RESOLUTION * 0.8;
        const zoomActive = this.active ? !zoomOff : zoomOn;
        const active = dense || zoomActive;
        this.setActive(active);
        if (!active) return;

        const now = performance.now();
        if (now - this.lastAggregateAt < VEHICLE_AGG_FEED.THROTTLE_MS) return;
        this.lastAggregateAt = now;

        const versionId = getActiveVersionId();
        if (!versionId) return;

        const { w, s, e, n } = bbox;
        const { fromTime, toTime } = this.timeWindow();

        axiosInstance.get(`/analytics/link-traffic/${versionId}`, {
            params: { bbox: `${w},${s},${e},${n}`, fromTime, toTime },
        }).then((res) => {
            if (this.destroyed) return;
            this.rebuildSyntheticVehicles(res.data?.links ?? []);
        }).catch((err: any) => {
            if (err?.response?.status !== 404) console.warn('[VehicleAggregationFeeder] 집계 호출 실패', err);
        });
    }

    private setActive(active: boolean): void {
        if (this.active === active) return;
        this.active = active;
        // useSimulation.ts의 czmlPositionWorker onmessage 핸들러가 이 플래그를 보고 heatmap/trip
        // feed를 건너뛴다 — 줌아웃 후에도 마지막 뷰포트의 실차량 worker feed가 살아있어서, 피더의
        // 합성 위치와 번갈아 같은 레이어를 덮어쓰며 재생 중 깜빡임을 일으켰던 것의 방지책.
        // 두 공급원 중 정확히 하나만 heatmap/trip을 소유하게 하는 단일 스위치.
        (this.layerManager as any).aggFeedActive = active;
        if (!active) {
            this.slots.fill(null);
            this.staticHeatPositions = [];
        }
        // ⚠️ 활성/비활성 **양방향 모두** trail 전체 리셋 — trip의 데이터 공급원이 스왑되는 순간
        // (worker의 실차량 위치 ↔ 피더의 합성 위치)에는 같은 인덱스 슬롯에 전혀 다른 위치가
        // 이어붙는다. 특히 활성화 방향 리셋이 빠져 있어서, 줌아웃 순간 실차량 꼬리 끝→합성 차량
        // 위치를 잇는 긴 직선이 슬롯마다 생겨 그물 무늬가 됐다(브라우저 재현으로 확정 — trail
        // 점프 가드는 dt 비례 허용치가 저FPS(프레임 수 초)에서 km 단위로 부풀어 못 잡았다).
        this.resetTripTrails(Array.from({ length: this.slots.length }, (_, i) => i));
        // ⚠️ 레이어 show/hide는 여기서 절대 건드리지 않는다 — 표시 여부는 분석 메뉴 온오프
        // (Analysis.tsx → activeLayerName → showLayer/hideLayer + PrimitiveLayerManager.add()의
        // activeLayerName 복원)가 전적으로 소유한다. 한때 줌 티어에 따라 여기서 강제로
        // showLayer/hideLayer 했으나 "줌에 따른 레이어 전환보다 사용자 온오프 + 줌은 세밀도만
        // 조절" 방침으로 제거됨. 이 피더는 데이터 공급원 역할만 한다.
    }

    /**
     * 재생 현재 시각 기준 ± 집계 시간창 (TrafficHeatmapCesiumLayer._timeWindow와 동일).
     *
     * ⚠️ clock 미준비(cur/start 없음) 시 예전엔 {0,0}을 반환했는데, 백엔드
     * (`VehicleDataReader.readLinkTraffic`)는 fromTime=toTime=0을 "시간창 없음(전체 시간 누적)"
     * 으로 해석한다 — region-traffic에서 실제로 겪은 것과 같은 함정(전체 시뮬 누적 volume이
     * 순간 스냅샷보다 훨씬 크게 나와 히트맵 밀도가 튀는 원인이 될 수 있음). clock이 아직
     * 준비 안 된 아주 짧은 구간에서만 발생하는 좁은 엣지케이스이긴 하지만, {0, 시간창×2}로
     * 안전한 유한 창을 반환하도록 통일한다.
     */
    private timeWindow(): { fromTime: number; toTime: number } {
        const sim = useSimulationStore.getState() as any;
        const cur = sim.currentTime;
        const start = sim.startTime ?? sim.simStartTime;
        const half = VEHICLE_AGG_FEED.TIME_WINDOW_SEC;
        if (!cur || !start) return { fromTime: 0, toTime: half * 2 };
        try {
            const sec = Math.round(JulianDate.secondsDifference(cur, start));
            return { fromTime: Math.max(0, sec - half), toTime: sec + half };
        } catch {
            return { fromTime: 0, toTime: half * 2 };
        }
    }

    /**
     * 링크별 volume/avgSpeed → 그 링크 위를 흐르는 합성 차량들(균등 분산 초기 위치).
     *
     * ⚠️ 예전엔 링크당 최대 6대로 volume 비중만큼만 배정했는데, 그러면 링크 길이는 무시한 채
     * 대수만 정해져서 — 긴 링크 위에 점 몇 개가 듬성듬성 이동하며 지나가는 꼴이 된다. HeatBarLayer
     * 는 grid cell(100m)마다 decay(0.95)로 빠르게 죽는데, 점이 하나 지나가고 다음 점이 올 때까지
     * 간격이 falloff 반경보다 넓으면 그 사이 셀은 완전히 어두워졌다가 다음 점이 지날 때 다시
     * 밝아진다 — "개별 셀이 꺼졌다 켜졌다" 깜빡임의 원인. 실제 개별 차량 히트맵이 안정적인 건
     * 차량 수가 많아 셀 사이 간격이 항상 촘촘하게 채워지기 때문이다.
     *
     * 그래서 링크당 대수의 **하한**을 volume 비중이 아니라 "링크 길이 / COVERAGE_SPACING_M"로
     * 정해 — 이 간격이 grid cell + falloff 반경보다 좁게 유지되도록 해서, 링크 전체 길이에
     * 걸쳐 항상 최소 하나의 점이 각 구간을 덮도록 한다(실제 차량이 아니라 밀도 시각화가
     * 목적이므로 정확한 대수보다 "빈 구간이 없는 것"이 중요).
     *
     * ⚠️ 이 최소 커버리지"만" 적용하면 volume(그 링크를 최근 지나간 차량 수)이 1이든 50이든
     * 링크 전체가 똑같이 "빈틈없이 채워진" 최대 밀도로 보인다 — HeatBarLayer 색상은 그리드
     * 전체 상대 최댓값 대비 정규화되므로, 한 프레임에 volume이 다른 링크들이 섞여 있어도
     * 전부 똑같이 새빨갛게 뜨는 문제가 있었다(실측 보고: "차량이 안 보이는 곳도 빨갛게
     * 나옴"). 최소 커버리지에 VOLUME_DENSITY_MAX_MULTIPLIER 이내에서 volume 기반 배율을
     * 곱해 — volume이 클수록 최소 커버리지보다 더 촘촘하게(추가 배치) 점을 늘려 falloff가
     * 겹치는 정도 자체를 키운다. 성기게 하는 방향(간격을 min보다 넓힘)은 셀이 비었다 다시
     * 채워지는 깜빡임을 재발시키므로 절대 쓰지 않고, 항상 최소 커버리지 이상으로만 조절한다.
     * 예산(MAX_SYNTHETIC_TOTAL) 초과 시에만 전체를 비례 축소(그래도 링크당 최소 1대는 유지).
     */
    private rebuildSyntheticVehicles(links: any[]): void {
        const valid = links.filter((lt: any) =>
            Array.isArray(lt.coordinates) && lt.coordinates.length >= 2 && (lt.volume ?? 0) > 0);

        interface LinkInfo {
            coords: Cesium.Cartesian3[]; cum: number[]; total: number; desiredCount: number; speed: number;
        }
        const infos = new Map<string, LinkInfo>();
        for (const lt of valid) {
            const coords: Cesium.Cartesian3[] = lt.coordinates.map((c: any) => Cesium.Cartesian3.fromDegrees(c.lng, c.lat));
            const cum: number[] = [0];
            for (let i = 1; i < coords.length; i++) {
                cum.push(cum[i - 1]! + Cesium.Cartesian3.distance(coords[i - 1]!, coords[i]!));
            }
            const total = cum[cum.length - 1] ?? 0;
            if (total <= 0) continue;
            // log2 스케일 — volume이 1→2로 늘 때마다 배율이 완만하게 커져, 소수 volume 차이
            // (1대 vs 2대)로 색이 과장되게 벌어지지 않으면서도 진짜 정체 구간(volume 수십~
            // 수백)은 뚜렷하게 더 진하게 보이도록 한다. volume=1(최근 딱 한 대만 지남)은
            // density=1로 기존과 동일한 최소 커버리지만 적용된다.
            const density = Math.min(
                VOLUME_DENSITY_MAX_MULTIPLIER,
                1 + Math.log2(Math.max(1, lt.volume ?? 1)),
            );
            // avgSpeed <= 0은 "실측 없음"(현재 스키마에서 항상 이 값) — ?? 는 0을 못 걸러내므로
            // 명시적으로 <=0 체크 (UNKNOWN_SPEED_KMH 주석 참고)
            const avgSpeedKmh = (lt.avgSpeed ?? 0) > 0 ? lt.avgSpeed : UNKNOWN_SPEED_KMH;
            infos.set(String(lt.linkId), {
                coords, cum, total,
                desiredCount: Math.max(1, Math.ceil((total / COVERAGE_SPACING_M) * density)),
                speed: Math.max(MIN_SPEED_MS, (avgSpeedKmh * 1000) / 3600),
            });
        }

        // 예산 초과 시 전체 비례 축소(링크당 최소 1대 보장) — 커버리지 촘촘함보다 예산이
        // 우선이면 낮은 volume 링크부터 성기게 만드는 대신 모든 링크를 균등하게 줄인다.
        let totalDesired = 0;
        infos.forEach((info) => { totalDesired += info.desiredCount; });
        const scale = Math.min(1, MAX_SYNTHETIC_TOTAL / (totalDesired || 1));
        const target = new Map<string, number>();
        infos.forEach((info, id) => target.set(id, Math.max(1, Math.round(info.desiredCount * scale))));

        // 1패스: 기존 슬롯 보존 — 같은 링크가 이번 집계에도 존재하고 목표 대수 이내면 그 차량을
        // 같은 슬롯·같은 진행도(t)로 유지한다(trail이 끊기지 않고 계속 이어짐). 사라진 링크의
        // 차량이나 목표 초과분은 슬롯을 비운다(null) — tick()이 undefined를 방출해 TailPrimitive가
        // 해당 trail을 자연스럽게 drain(서서히 소멸)시킨다.
        const kept = new Map<string, number>();
        for (let i = 0; i < this.slots.length; i++) {
            const v = this.slots[i];
            if (!v) continue;
            const tgt = target.get(v.linkId) ?? 0;
            const k = kept.get(v.linkId) ?? 0;
            if (k < tgt) {
                kept.set(v.linkId, k + 1);
                v.speed = infos.get(v.linkId)!.speed; // 최신 avgSpeed만 반영
            } else {
                this.slots[i] = null;
            }
        }

        // 2패스: 부족분(새 링크 또는 증원)을 빈 슬롯에 배치. 새로 배정된 슬롯 인덱스는 모아서
        // trip(TailPrimitive)에 동기적으로 resetTrails() 호출 — 그 슬롯의 이전 trail(다른 링크
        // 잔상)을 즉시 비워 이전 위치→새 위치 직선 띠(그물 무늬)를 원천 차단한다.
        // ("undefined 한 tick 방출" 방식은 requestRenderMode에서 프레임이 뜸하면 다음 feed에
        // 덮여 관측되지 못하는 경쟁이 있었음 — 특히 초기 로딩 중 무더기 재배정에서 그물 발생.)
        const newIndices: number[] = [];
        let free = 0;
        infos.forEach((info, id) => {
            const tgt = target.get(id) ?? 0;
            const k = kept.get(id) ?? 0;
            for (let n = k; n < tgt; n++) {
                while (free < this.slots.length && this.slots[free]) free++;
                if (free >= this.slots.length) return;
                this.slots[free] = {
                    linkId: id, coords: info.coords, cum: info.cum, total: info.total,
                    t: (info.total * n) / tgt, speed: info.speed,
                };
                newIndices.push(free);
            }
        });
        if (newIndices.length > 0) this.resetTripTrails(newIndices);

        // heatmap(밀도)은 trip(흐름)과 달리 움직일 필요가 없다 — 여러 합성 차량이 같은 속도로
        // 나란히(lock-step) 움직이면 grid cell 경계를 동시에 넘나들며 셀 단위로 상관된 on/off
        // 전환이 생겨 깜빡임으로 보인다. 그래서 heatmap용 위치는 이 집계 갱신(THROTTLE_MS≈1s)
        // 시점의 정지 스냅샷으로 고정하고(tick()이 계속 재공급), trip만 이동 위치를 받는다.
        this.staticHeatPositions = [];
        for (const v of this.slots) if (v) this.staticHeatPositions.push(this.positionAt(v));
    }

    /** trip(TailPrimitive)에 특정 슬롯의 trail 초기화를 동기적으로 지시 — 재배정/순환 등
     *  위치 연속성이 끊기는 슬롯의 직선 띠 잔상 방지 (TailPrimitive.resetTrails 주석 참고). */
    private resetTripTrails(indices: number[]): void {
        const group = this.layerManager?.getLayerGroup?.("analyze") ?? [];
        for (const layer of group) {
            if (layer && layer.layer === "trip" && typeof layer.resetTrails === "function") {
                try { layer.resetTrails(indices); } catch (_) {}
            }
        }
    }

    private positionAt(v: SyntheticVehicle): number[] {
        let idx = 0;
        while (idx < v.cum.length - 2 && v.cum[idx + 1]! < v.t) idx++;
        const segStart = v.cum[idx]!, segEnd = v.cum[idx + 1]!;
        const localT = segEnd > segStart ? (v.t - segStart) / (segEnd - segStart) : 0;
        const a = v.coords[idx]!, b = v.coords[idx + 1]!;
        return [
            a.x + (b.x - a.x) * localT,
            a.y + (b.y - a.y) * localT,
            a.z + (b.z - a.z) * localT,
        ];
    }

    private tick(): void {
        if (this.destroyed || !this.active) return;
        const now = performance.now();
        const dt = Math.min(0.5, (now - this.lastTickAt) / 1000);
        this.lastTickAt = now;

        let hasAny = false;
        for (const v of this.slots) if (v) { hasAny = true; break; }
        if (!hasAny) return;

        // ⚠️ 이 tick()은 performance.now() 기준 실시간 setInterval이라 시뮬레이션 재생/정지
        // (isRunning)와 원래 무관하게 계속 움직였다 — 사용자가 재생을 멈춰도 합성 차량(trip용
        // 이동 위치)은 계속 이동해 "정지 상태에서도 깜빡임"으로 이어졌다. 정지 중엔 위치를
        // 얼리고(advance 생략) trip에도 같은 위치를 계속 재공급만 한다(TailPrimitive는 decay가
        // 없어 안 먹여도 마지막 모양 그대로 멈추지만, 굳이 나눌 필요 없어 일관되게 재공급).
        const running = (useSimulationStore.getState() as any).isRunning === true;
        const positions: (number[] | undefined)[] = new Array(this.slots.length);
        const wrapped: number[] = [];
        for (let i = 0; i < this.slots.length; i++) {
            const v = this.slots[i];
            if (!v) { positions[i] = undefined; continue; }
            if (running) {
                v.t += v.speed * dt;
                if (v.t >= v.total) {
                    // 링크 끝→시작 순환: 그대로 위치를 이어 보내면 TailPrimitive가 (10km 미만
                    // 점프는 정상 이동으로 간주하므로) 링크 끝에서 시작점까지 곡선 도로를
                    // 가로지르는 직선 띠를 그린다. resetTrails()로 해당 trail만 동기 초기화하고
                    // 시작점 위치를 그대로 보낸다("undefined 한 tick" 방식은 프레임이 뜸하면
                    // 관측 못 하는 경쟁이 있어 그물 무늬가 남았음 — resetTrails 주석 참고).
                    v.t %= v.total;
                    wrapped.push(i);
                }
            }
            positions[i] = this.positionAt(v);
        }
        if (wrapped.length > 0) this.resetTripTrails(wrapped);

        const group = this.layerManager?.getLayerGroup?.("analyze") ?? [];
        for (const layer of group) {
            if (!layer || typeof layer.setLatestPositions !== "function") continue;
            try {
                if (layer.layer === "trip") {
                    // maxSegmentM: 합성 차량의 물리 한계 명시 — 최고 속도 ~40m/s × 렌더 프레임
                    // 간격(저FPS 수 초) 동안의 이동을 여유 있게 덮는 200m. 이보다 큰 점프는 전부
                    // 버그(재배정/스왑 등 가드 누락 경로)이므로 TailPrimitive가 무조건 리셋한다 —
                    // dt 기반 추정 허용치(250~1500m)로는 도시 스케일 줌에서 여전히 그물로 보이는
                    // 중간 길이 직선을 못 걸렀다.
                    layer.setLatestPositions({ positions, maxSegmentM: 200 });
                } else if (layer.layer === "heatmap") {
                    // heatmap(밀도)은 trip(흐름)과 달리 움직일 필요가 없다 — 여러 합성 차량이 같은
                    // 속도로 나란히(lock-step) 움직이면 grid cell 경계를 동시에 넘나들며 셀 단위로
                    // 상관된 on/off 전환이 생겨 깜빡임으로 보인다(실제 개별 차량은 무작위로 흩어져
                    // 있어 이 문제가 없음). rebuildSyntheticVehicles()가 집계 갱신 시점에만 계산해둔
                    // 정적 스냅샷(staticHeatPositions)을 여기서 계속 재공급 — 위치는 고정, decay로
                    // 서서히 꺼지지 않게 매 tick 다시 먹인다.
                    layer.setLatestPositions({ positions: this.staticHeatPositions });
                }
            } catch (e) { console.warn('[VehicleAggregationFeeder] setLatestPositions 실패:', e); }
        }
        try { this.viewer.scene.requestRender(); } catch (_) {}
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.layerManager) (this.layerManager as any).aggFeedActive = false;
        this.camUnsub?.();
        this.simUnsub?.();
        this.denseUnsub?.();
        if (this.scheduleTimer) clearTimeout(this.scheduleTimer);
        if (this.tickTimer) clearInterval(this.tickTimer);
        this.slots.fill(null);
        this.staticHeatPositions = [];
    }
}
