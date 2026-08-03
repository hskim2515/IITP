import {GeoJsonDataSource, Viewer} from "cesium";
import {layerNameToStoreMap} from "@hooks/useLayerInit";
import {interpolateByOffset} from "@utils/interpolateByOffset";
import {FEATURE_TYPE, PavementMarkingData, PavementMarkingType} from "@type/PavementMarking";
import {Feature} from "ol";
import {Point} from "ol/geom";
import {fromLonLat} from "ol/proj";
import {convertFeatureToRecord} from "@utils/feature";
import * as Cesium from "cesium";
import { getActiveVersionId } from "@utils/versionId";
import { PAVEMENT_MARKING_TILING } from "@utils/lodConstants";
import { PavementMarkingTileManager } from "@managers/PavementMarkingTileManager";
import { PavementMarkingTileMembership } from "@managers/pavementMarkingTileMembership";
import { diffRecordEditsById } from "@utils/tileEditDiff";
import { buildFileUrl } from "@utils/fileUrl";

/** 노면표시 실지리 정사각형 footprint 한 변 길이(m) — 도로 위 실제 페인트 마킹 크기에
 *  가깝게(예전 billboard의 1x2m은 일반적인 조망 고도에서 1픽셀도 안 돼 보이지도 않았다).
 *  ⚠️ footprint 자체은 회전시키지 않는다(항상 동서남북 정렬 정사각형) — polygon 정점을
 *  회전시켜도 그 위에 입히는 이미지 텍스처(ImageMaterialProperty)의 UV 매핑이 정점 순서를
 *  따라가지 않아 도형 윤곽은 돌아가는데 이미지 내용은 안 따라 도는 문제가 실측으로 확인됐다
 *  ("표시는 되는데 방향이 안맞음"). 회전은 대신 이미지 픽셀 자체에 canvas로 미리 구워 넣는다
 *  (getRotatedImage/rotateImage 참고) — footprint는 정사각형·무회전이라 Cesium의 자동 UV
 *  매핑이 어떤 축을 쓰든 항상 예측 가능하게 맞아떨어진다. */
const MARK_FOOTPRINT_M = 3.0;

/** 카메라 위치 기준 컬링 반경(m) — 히스테리시스(진입/이탈 반경을 다르게) 적용.
 *  ⚠️ 서버 타일 fetch(updateTiles)의 bbox는 camera.computeViewRectangle()로 구하는데, 카메라가
 *  지평선 쪽으로 기울면 이 값이 실제 화면에 보이는 범위보다 훨씬 넓게(때로는 거의 전역 규모로)
 *  나오는 Cesium의 알려진 특성이 있다 — 그 결과 "아주 먼 곳" 타일까지 요청/렌더링되는 문제가
 *  있었다(실사용 재현). 신호등/버스정류장도 동일한 이유로 서버 bbox fetch와는 별개로
 *  camera.positionWC 기준 3D 유클리드 거리 컬링을 추가로 둔다.
 *  ⚠️ 진입/이탈에 같은 값을 쓰면 카메라가 그 경계 거리 부근에 머물 때마다(느린 팬, 정지 후
 *  미세 이동 등) 마킹이 반경 안팎을 오가며 추가/제거를 반복해 깜빡인다(실사용 재현: "보였다
 *  안보였다" — 신호등 코드의 "5% 버퍼(경계 깜빡임 방지)" 주석도 동일 문제의 흔적). 이탈
 *  반경을 진입 반경보다 눈에 띄게 크게 둬 경계에서 진동하지 않는 데드존을 만든다. */
const ENTER_RADIUS = 350;
const EXIT_RADIUS = 500;

interface MarkingEntry {
    id: string;
    lng: number; lat: number;
    markingType: string; angle: number;
    cartesian: Cesium.Cartesian3;
}

export default class PavementMarkingDataSourceLayer {
    private readonly LAYER_NAME = "pavementMarking";
    public readonly dataSource: GeoJsonDataSource;
    private unsubscribe: () => void;
    private networkUnsubscribe: (() => void) | null = null;
    private reloadTimer: ReturnType<typeof setTimeout> | null = null;
    /** 보간 실패(차선 타일 미로드)로 스킵된 마킹 존재 여부 — 네트워크 동기화 시 재로드 트리거 */
    private hasUnresolved = false;
    /** load()가 dataSource.show=false 때문에 건너뛴 경우 — 다시 켜지면 재로드 필요 */
    private needsReload = false;

    /** 전체 마킹 위치 데이터(Cesium 객체 없음, 메모리만) — camera 반경 컬링의 소스 */
    private allEntries: MarkingEntry[] = [];
    /** 현재 Cesium에 추가된(카메라 반경 안) 마킹 — key = marking id */
    private activeRecords: Map<string, Cesium.Entity> = new Map();
    private cullTimer: ReturnType<typeof setTimeout> | null = null;
    private onCameraChanged = () => this.scheduleCull();
    /** 타일 이벤트로 트리거된 load() 배치용 디바운스 타이머 — 팬/줌 중 타일이 짧은 시간에
     *  연달아(뷰포트 하나당 8~12개) 도착하는데, 그때마다 load()가 전체를 지우고 다시 그려서
     *  깜빡임이 생겼다. 여러 타일 이벤트를 하나의 재빌드로 묶는다. */
    private loadTimer: ReturnType<typeof setTimeout> | null = null;
    /** addMarkingsBatch() 재진입 가드 — 지형 고도 샘플링(비동기) 중 카메라가 또 움직여 새
     *  배치가 시작되면 이전 배치의 결과는 폐기(중복 추가 방지). */
    private addBatchSeq = 0;
    /** (아이콘 url + 반올림 각도) → 회전된 이미지 data URL 캐시 — 마킹 수만큼이 아니라 실제로
     *  서로 다른 (아이콘타입, 대략적 방향) 조합 수만큼만 회전 작업이 필요하다. */
    private rotatedImageCache = new Map<string, Promise<string>>();

    // ── 노면표시 타일링 (PAVEMENT_MARKING_TILING.ENABLED 일 때만; 읽기 전용) ──
    private tileManager: PavementMarkingTileManager | null = null;
    private tileVersionId: string | null = null;
    private membership = new PavementMarkingTileMembership();

    constructor(private viewer: Viewer) {
        // ⚠️ dataSource는 이 인스턴스 수명 동안 딱 한 번만 만들어 재사용한다 — 예전엔 load()가
        // 호출될 때마다(팬/줌으로 타일 갱신될 때마다, 매우 빈번) dataSource를 통째로 새로
        // 만들어서, DataSourceLayerManager의 show()/hide()가 직접 잡고 있던 Cesium 객체가
        // 매번 교체돼 사용자가 체크박스로 꺼둔 상태를 다음 로드에서 잃어버렸다(실측: "3D
        // on/off 안 됨"). 버스/철도정류장·신호등과 동일하게 dataSource는 고정하고, 데이터
        // 갱신 시엔 내부 entities만 diff-add/remove한다 — DataSourceLayerManager가 잡고 있는
        // 참조가 항상 유효해 toggle이 구조적으로 안전하다.
        this.dataSource = new GeoJsonDataSource(this.LAYER_NAME);
        this.viewer.dataSources.add(this.dataSource);
        this.viewer.scene.camera.changed.addEventListener(this.onCameraChanged);

        const store = layerNameToStoreMap[this.LAYER_NAME];
        this.unsubscribe = store.subscribe(
            (state) => state.currentJsonData,
            () => this.load(),
            { fireImmediately: true }
        );
        // 저장 완료(isChanged: true → false) — Bus/RailStationDataSourceLayer와 동일 조치.
        (store as any).subscribe(
            (s: any) => s.isChanged,
            (isChanged: boolean, prevIsChanged: boolean) => {
                if (!prevIsChanged || isChanged) return;
                const cur = store.getState().currentJsonData;
                if (cur) store.getState().setOriginData(cur);
                if (PAVEMENT_MARKING_TILING.ENABLED) {
                    this.tileManager?.clear();
                    this.updateTiles();
                }
            },
        );

        if (PAVEMENT_MARKING_TILING.ENABLED) this.updateTiles();

        // 타일 모드: 마킹 좌표는 OL network 레이어의 lane-edit 피처(=detail LOD viewport 타일)에서
        // 보간되므로, 로드 시점에 차선이 없던 마킹은 스킵됨. 타일 로드 후 네트워크 store 동기화를
        // 구독해 미해결 마킹이 있을 때만 재로드한다.
        const networkStore = layerNameToStoreMap["network"] as any;
        this.networkUnsubscribe = networkStore?.subscribe(
            (state: any) => state.currentJsonData,
            () => {
                if (!this.hasUnresolved) return;
                this.scheduleReload();
            },
        ) ?? null;
    }

    /** viewport 마킹(서버 최신, 타일) + 로컬 미저장 편집을 id 단위로 병합 (2D 레이어와 동일 조치). */
    private computeMergedMarkings(): any[] {
        const store = layerNameToStoreMap[this.LAYER_NAME];
        const currentJsonData = store?.getState().currentJsonData;
        const pavementMarkings = currentJsonData?.pavementMarkings ?? [];
        if (!PAVEMENT_MARKING_TILING.ENABLED) return pavementMarkings;

        const originData = store?.getState().originData as any;
        const { editedIds, deletedIds } = diffRecordEditsById(originData?.pavementMarkings, pavementMarkings, 'id');
        const merged = new Map<string, any>();
        for (const m of this.membership.values()) {
            const id = String(m?.id ?? '');
            if (deletedIds.has(id)) continue;
            merged.set(id, m);
        }
        for (const m of pavementMarkings) {
            const id = String(m?.id ?? '');
            if (editedIds.has(id)) merged.set(id, m);
        }
        return [...merged.values()];
    }

    /** 카메라 이동 후 200ms 디바운스로 컬링 실행 + 타일 모드면 viewport 마킹 갱신 */
    private scheduleCull(): void {
        if (this.cullTimer) return;
        this.cullTimer = setTimeout(() => {
            this.cullTimer = null;
            this.updateVisibleMarkings();
            if (PAVEMENT_MARKING_TILING.ENABLED) this.updateTiles();
        }, 200);
    }

    private updateTiles(): void {
        if (!PAVEMENT_MARKING_TILING.ENABLED) return;
        const rect = this.viewer.camera.computeViewRectangle(this.viewer.scene.globe.ellipsoid);
        if (!rect) return;
        const west = Cesium.Math.toDegrees(rect.west);
        const south = Cesium.Math.toDegrees(rect.south);
        const east = Cesium.Math.toDegrees(rect.east);
        const north = Cesium.Math.toDegrees(rect.north);
        const versionId = getActiveVersionId();
        if (!versionId) return;
        // 버전 전환 감지 — 이전 버전 노면표시 타일/멤버십 폐기 후 재생성(bus/rail station과 동일 패턴)
        if (this.tileManager && this.tileVersionId !== String(versionId)) {
            try { this.tileManager.clear(); } catch (_) { /* noop */ }
            this.tileManager = null;
        }
        this.tileVersionId = String(versionId);
        if (!this.tileManager) {
            this.tileManager = new PavementMarkingTileManager(String(versionId), {
                onTileLoaded: (_k, payload) => { if (this.membership.add(payload)) this.scheduleLoad(); },
                onTileEvicted: (_k, payload) => { if (this.membership.remove(payload)) this.scheduleLoad(); },
            });
        }
        this.tileManager.updateForBbox(west, south, east, north);
    }

    /** 짧은 시간(150ms) 안에 몰려오는 여러 타일 이벤트를 하나의 load()로 묶는다 — 팬/줌 중
     *  뷰포트 하나당 타일 8~12개가 거의 동시에 도착하는데, 매번 load()가 전체를 지우고 다시
     *  그리면 그만큼 깜빡였다. */
    private scheduleLoad(): void {
        if (this.loadTimer) { clearTimeout(this.loadTimer); }
        this.loadTimer = setTimeout(() => {
            this.loadTimer = null;
            this.load();
        }, 150);
    }

    private scheduleReload(): void {
        if (this.reloadTimer) return;
        this.reloadTimer = setTimeout(() => {
            this.reloadTimer = null;
            this.load();
        }, 300);
    }

    public setVisible(visible: boolean): void {
        this.dataSource.show = visible;
        if (visible && this.needsReload) this.load();
    }

    public load(): void {
        if (!this.dataSource.show) { this.needsReload = true; return; }
        this.needsReload = false;

        const pavementMarkings = this.computeMergedMarkings();
        const features = pavementMarkings
            .map((data) => this.createFeature(data));
        const mergedFeatures = interpolateByOffset(features);

        const flatRows = mergedFeatures
            .map(f => convertFeatureToRecord(f))
            .filter(r => r.id !== undefined && !isNaN(Number(r.id)));

        // 보간 실패 마킹([0,0]→toLonLat→lng/lat 0)이 남아 있으면 네트워크 타일 로드 시 재시도 대상
        this.hasUnresolved = flatRows.some(r => {
            const c = r.coordinates?.[0];
            return !c?.lng || !c?.lat;
        });

        const nextEntries: MarkingEntry[] = [];
        for (const row of flatRows) {
            const { coordinates, id, markingType, angle } = row;
            const coord = coordinates?.[0];
            const lng = coord?.lng;
            const lat = coord?.lat;
            if (!lng || !lat) continue;

            nextEntries.push({
                id: String(id), lng, lat, markingType, angle: angle ?? 0,
                cartesian: Cesium.Cartesian3.fromDegrees(lng, lat),
            });
        }
        this.allEntries = nextEntries;

        // ⚠️ 예전엔 여기서 clearAllActive()로 활성 마킹을 전부 지운 뒤 updateVisibleMarkings()가
        // 다시 채웠는데, load()가 타일 이벤트마다(디바운스해도 여전히 데이터 갱신 시마다) 호출돼
        // 카메라 반경 안에서 이미 정상 표시 중이던 마킹까지 매번 지웠다 다시 그려 깜빡였다.
        // updateVisibleMarkings()는 이미 diff(추가/제거)로 동작하므로 여기서 미리 지울 필요가
        // 없다 — allEntries에서 사라진 id만 자연히 제거되고, 그대로 남아있는 id는 건드리지 않는다.
        this.updateVisibleMarkings();
    }

    /** 카메라 위치 기준 반경(히스테리시스) 안의 마킹만 활성화, 범위 밖은 제거 (diff). */
    private updateVisibleMarkings(): void {
        if (!this.dataSource.show) return;

        const camPos = this.viewer.scene.camera.positionWC;
        const enterR2 = ENTER_RADIUS * ENTER_RADIUS;
        const exitR2 = EXIT_RADIUS * EXIT_RADIUS;

        const entryByAllId = new Map(this.allEntries.map(e => [e.id, e] as const));

        /* 범위 밖으로(이탈 반경 초과) 나갔거나 더 이상 존재하지 않는 것 제거 */
        for (const [id, entity] of this.activeRecords) {
            const e = entryByAllId.get(id);
            let outOfRange = true;
            if (e) {
                const dx = camPos.x - e.cartesian.x;
                const dy = camPos.y - e.cartesian.y;
                const dz = camPos.z - e.cartesian.z;
                outOfRange = (dx * dx + dy * dy + dz * dz) > exitR2;
            }
            if (outOfRange) {
                this.dataSource.entities.remove(entity);
                this.activeRecords.delete(id);
            }
        }

        /* 새로 진입 반경 안에 들어온 것 추가 — 지형 고도 샘플링이 비동기라 배치로 묶어 처리 */
        const toAdd: MarkingEntry[] = [];
        for (const e of this.allEntries) {
            if (this.activeRecords.has(e.id)) continue;
            const dx = camPos.x - e.cartesian.x;
            const dy = camPos.y - e.cartesian.y;
            const dz = camPos.z - e.cartesian.z;
            if (dx * dx + dy * dy + dz * dz <= enterR2) toAdd.push(e);
        }
        if (toAdd.length > 0) {
            this.addMarkingsBatch(toAdd).catch(err => console.error("[PavementMarking] 마킹 추가 실패:", err));
        }
    }

    /** ⚠️ 실측: polygon.classificationType(지형 드레이프) + ImageMaterialProperty(텍스처)
     *  조합은 Cesium에서 안정적으로 렌더되지 않았다(아예 안 보임) — 색상 단색 머티리얼만
     *  안전하게 지원되는 걸로 보인다. 대신 이 코드베이스가 이미 검증한 방식(SignalDataSourceLayer가
     *  신호기 폴 세울 때 지형 고도를 실측 샘플링하는 것과 동일한 기법)으로, 각 마킹 위치의 실제
     *  지형 고도를 미리 구해 그 위에 "일반"(비-classification) polygon을 절대 고도로 배치한다 —
     *  일반 polygon + 텍스처 머티리얼은 매우 표준적으로 지원되는 조합이라 훨씬 안전하다.
     *  지형 고도 샘플링과 이미지 회전(비동기, 캐시)을 병렬로 준비한 뒤 한 번에 엔티티를 추가한다. */
    private async addMarkingsBatch(entries: MarkingEntry[]): Promise<void> {
        const seq = ++this.addBatchSeq;

        const heightsPromise: Promise<number[] | null> = (async () => {
            const hasRealTerrain = !(this.viewer.terrainProvider instanceof Cesium.EllipsoidTerrainProvider);
            if (!hasRealTerrain) return null;
            try {
                const cartos = entries.map(e => Cesium.Cartographic.fromDegrees(e.lng, e.lat));
                await Cesium.sampleTerrainMostDetailed(this.viewer.terrainProvider, cartos);
                return cartos.map(c => c.height ?? 0);
            } catch (err) {
                console.warn("[PavementMarking] 지형 고도 샘플링 실패, 0m 기준으로 폴백:", err);
                return null;
            }
        })();

        const imagePromises = entries.map(e => {
            const iconFile = PavementMarkingType[e.markingType];
            const url = buildFileUrl(`models/${ iconFile }`);
            return this.getRotatedImage(url, e.angle);
        });

        const [heights] = await Promise.all([
            heightsPromise,
            Promise.allSettled(imagePromises),
        ]);
        if (seq !== this.addBatchSeq) return; // 그 사이 카메라가 또 움직여 새 배치가 시작됨 — 이 결과는 폐기

        this.dataSource.entities.suspendEvents();
        try {
            for (let i = 0; i < entries.length; i++) {
                const e = entries[i]!;
                if (this.activeRecords.has(e.id)) continue; // 겹치는 배치로 이미 추가된 경우 방지
                let rotatedImg: string;
                try {
                    rotatedImg = await imagePromises[i]!;
                } catch (err) {
                    console.warn(`[PavementMarking] 아이콘 회전 실패, 건너뜀 (id=${e.id}):`, err);
                    continue;
                }
                const baseH = heights ? (heights[i] ?? 0) : 0;
                this.addMarking(e, baseH, rotatedImg);
            }
        } finally {
            this.dataSource.entities.resumeEvents();
            try { this.viewer.scene.requestRender(); } catch (_) {}
        }
    }

    private addMarking(e: MarkingEntry, baseHeight: number, rotatedImageUrl: string): void {
        const footprintCoords = this.computeSquareFootprint(e.lng, e.lat, MARK_FOOTPRINT_M);
        const heightAboveGround = baseHeight + 0.1;
        const positionsWithHeight: number[] = [];
        for (let i = 0; i < footprintCoords.length; i += 2) {
            positionsWithHeight.push(footprintCoords[i]!, footprintCoords[i + 1]!, heightAboveGround);
        }

        const entity = this.dataSource.entities.add({
            id: `pavementMarking-${e.id}`,
            // ⚠️ billboard(카메라를 향하는 평면) 대신 polygon(실제 지리 좌표 도형)을 쓴다 —
            // 도형 자체는 카메라와 무관한 절대좌표라 회전 문제가 성립하지 않는다. 다만 footprint는
            // 항상 무회전 정사각형으로 고정하고(computeSquareFootprint), 실제 방향은 이미지
            // 픽셀에 미리 구워 넣는다(getRotatedImage) — 도형 윤곽을 직접 회전시키면 그 위의
            // 이미지 텍스처가 따라 돌지 않는 문제가 실측으로 확인됐다.
            polygon: {
                hierarchy: Cesium.Cartesian3.fromDegreesArrayHeights(positionsWithHeight),
                material: new Cesium.ImageMaterialProperty({ image: rotatedImageUrl, transparent: true }),
                perPositionHeight: true,
            },
        });
        this.activeRecords.set(e.id, entity);
    }

    /** center(lng,lat)를 중심으로 한 sideMeters x sideMeters 무회전(동서남북 정렬) 정사각형의
     *  4개 꼭짓점을 [lng1,lat1,...] 형태로 반환. */
    private computeSquareFootprint(lng: number, lat: number, sideMeters: number): number[] {
        const center = Cesium.Cartesian3.fromDegrees(lng, lat);
        const enuTransform = Cesium.Transforms.eastNorthUpToFixedFrame(center);
        const half = sideMeters / 2;

        const localPositions = [
            new Cesium.Cartesian3(-half, half, 0),
            new Cesium.Cartesian3(half, half, 0),
            new Cesium.Cartesian3(half, -half, 0),
            new Cesium.Cartesian3(-half, -half, 0),
        ];
        const worldPositions = localPositions.map(p => Cesium.Matrix4.multiplyByPoint(enuTransform, p, new Cesium.Cartesian3()));
        return worldPositions.map(p => {
            const carto = Cesium.Cartographic.fromCartesian(p);
            return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)];
        }).flat();
    }

    /** rotateImage()를 (url, 반올림 각도) 단위로 캐싱한 래퍼 — 인스턴스 수명 동안(여러 배치에
     *  걸쳐) 재사용된다. 각도를 1도 단위로 반올림하는 건 시각적으로 구분 안 되는 정밀도 손실을
     *  감수하고, 비슷한 방향의 마킹들(같은 도로를 따라 늘어선 교차로 진입 차선들)이 캐시를
     *  공유하게 하기 위함. */
    private getRotatedImage(url: string, angle: number): Promise<string> {
        const angleDeg = Math.round(angle * (180 / Math.PI));
        const key = `${url}@${angleDeg}`;
        let cached = this.rotatedImageCache.get(key);
        if (!cached) {
            cached = this.rotateImage(url, angleDeg * (Math.PI / 180));
            this.rotatedImageCache.set(key, cached);
        }
        return cached;
    }

    /** footprint는 무회전(항상 동서남북 정렬)이므로, angleRad(진북 기준 시계 방향 방위각)를
     *  이미지 픽셀 자체에 canvas로 구워 넣는다. canvas 2D의 ctx.rotate(θ)는 양수 θ가 시계
     *  방향이라(y축이 아래로 향하는 픽셀 좌표계) 우리 방위각 정의와 부호 변환 없이 그대로
     *  맞는다(interpolateAlongLine/PavementMarkingCoordinateResolver와 동일 각도 정의). */
    private rotateImage(url: string, angleRad: number): Promise<string> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = url;

            img.onload = () => {
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    reject(new Error("Canvas context not available"));
                    return;
                }

                const size = Math.max(img.width, img.height);
                canvas.width = size;
                canvas.height = size;

                ctx.translate(size / 2, size / 2);
                ctx.rotate(angleRad);
                ctx.drawImage(img, -img.width / 2, -img.height / 2);

                resolve(canvas.toDataURL("image/png"));
            };

            img.onerror = (e) => {
                reject(e);
            };
        });
    }

    public destroy(): void {
        this.unsubscribe?.();
        this.networkUnsubscribe?.();
        if (this.reloadTimer) {
            clearTimeout(this.reloadTimer);
            this.reloadTimer = null;
        }
        if (this.cullTimer) { clearTimeout(this.cullTimer); this.cullTimer = null; }
        if (this.loadTimer) { clearTimeout(this.loadTimer); this.loadTimer = null; }
        this.viewer.scene.camera.changed.removeEventListener(this.onCameraChanged);
        this.tileManager?.clear();
        this.tileManager = null;
        this.viewer.dataSources.remove(this.dataSource, true);
    }

    public createFeature(data: PavementMarkingData): Feature<Point> | undefined {
        const props: PavementMarkingData = {
            ...data,
            featureType: data.featureType ?? FEATURE_TYPE.PAVEMENT_MARKING,
        };
        // 서버(PavementMarkingCoordinateResolver)가 이미 실좌표를 계산해 저장해뒀으면 그걸 바로
        // 쓴다 — interpolateByOffset의 차선 지오메트리 재계산(2D 'detail' 줌에서만 가능)에
        // 의존하지 않아도 되므로, 줌 레벨과 무관하게 즉시 표시된다. 좌표가 아직 없는 경우
        // (드물게, 재계산 실패나 구버전 데이터)에만 [0,0] placeholder로 두고 재계산에 맡긴다.
        const coord = data.coordinates?.[0];
        const hasValidCoordinate = typeof coord?.lng === 'number' && typeof coord?.lat === 'number';
        const geom = hasValidCoordinate ? new Point(fromLonLat([coord!.lng!, coord!.lat!])) : new Point([0, 0]);
        const feature = new Feature<Point>(geom);

        feature.setProperties(props);

        return feature;
    }
}
