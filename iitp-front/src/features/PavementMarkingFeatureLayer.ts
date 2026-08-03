import VectorSource from "ol/source/Vector";
import VectorLayer from "ol/layer/Vector";
import { Icon, Style } from "ol/style";
import {layerNameToStoreMap} from "@hooks/useLayerInit";
import { Feature } from "ol";
import {
    FEATURE_TYPE,
    PAVEMENT_MARKING_SNAP_FIELDS, PavementMarkingData, PavementMarkingSnapProperties,
    PavementMarkingType,
    SNAP_FEATURE_TYPE,
    SNAP_LAYER
} from "@type/PavementMarking";
import {
    getAngleByCoordinate, getCellOffsetRelativeToCell,
} from "@utils/feature";
import { toLonLat, fromLonLat } from "ol/proj";
import { Point } from "ol/geom";
import { Coordinate } from "ol/coordinate";
import { generateGUIDWithType } from "@utils/guid";
import {interpolateByOffset} from "@utils/interpolateByOffset";
import Geometry from "ol/geom/Geometry";
import type OLMap from "ol/Map";
import { getActiveVersionId } from "@utils/versionId";
import { PAVEMENT_MARKING_TILING } from "@utils/lodConstants";
import { PavementMarkingTileManager } from "@managers/PavementMarkingTileManager";
import { PavementMarkingTileMembership } from "@managers/pavementMarkingTileMembership";
import { diffRecordEditsById } from "@utils/tileEditDiff";
import { unByKey } from "ol/Observable";
import type { EventsKey } from "ol/events";
import { buildFileUrl } from "@utils/fileUrl";

export class PavementMarkingFeatureLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "pavementMarking";
    private unsubscribe: () => void;
    private networkUnsubscribe: (() => void) | null = null;
    private reinterpolateTimer: ReturnType<typeof setTimeout> | null = null;

    // ── 노면표시 타일링 (PAVEMENT_MARKING_TILING.ENABLED 일 때만; 읽기 전용) ──
    private tileManager: PavementMarkingTileManager | null = null;
    private membership = new PavementMarkingTileMembership();
    private moveEndKey: EventsKey | null = null;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: true,

            style: (feature: Feature, resolution: number) => {
                // 보간 전(차선 타일 미로드) 피처는 [0,0] 임시 geometry — 렌더 생략
                const c = (feature.getGeometry() as Point | undefined)?.getCoordinates();
                if (!c || (c[0] === 0 && c[1] === 0)) return undefined;
                const baseResolution = 1.2;
                const scale = 0.05 * (baseResolution / resolution);
                const markingType = feature.get("markingType");
                const iconFile = PavementMarkingType[markingType];
                const url = buildFileUrl(`models/${ iconFile }`);

                const angle = feature.get("angle") || 0;
                return new Style({
                    image: new Icon({
                        src: url,
                        scale,
                        anchor: [ 0.5, 1 ],
                        rotateWithView: true,
                        rotation: angle,
                    }),
                });
            },
            zIndex: 400,
            updateWhileAnimating: true,
            updateWhileInteracting: true,
        });

        this.source = source;

        const store = layerNameToStoreMap[this.LAYER_NAME];

        this.load();

        this.unsubscribe = store.subscribe(
            (state: any) => state.currentJsonData,
            () => this.load(),
            { equalityFn: (a: any, b: any) => a === b }
        );
        // 저장 완료(isChanged: true → false) — Bus/RailStationFeatureLayer와 동일 조치.
        (store as any).subscribe(
            (s: any) => s.isChanged,
            (isChanged: boolean, prevIsChanged: boolean) => {
                if (!prevIsChanged || isChanged) return;
                const cur = store.getState().currentJsonData;
                if (cur) store.getState().setOriginData(cur);
                if (PAVEMENT_MARKING_TILING.ENABLED) {
                    this.tileManager?.clear();
                    const map = this.getMapInternal() as OLMap | null;
                    if (map) this.updateTiles(map);
                }
            },
        );

        // 타일 모드: lane-edit 피처는 detail LOD viewport 타일에만 존재해 마킹 로드 시점에
        // 차선이 없으면 보간 실패(geometry [0,0]). 타일 로드 후 네트워크 store 동기화가
        // 발생하므로 이를 구독해 미해결 마킹만 재보간한다.
        const networkStore = layerNameToStoreMap["network"] as any;
        this.networkUnsubscribe = networkStore?.subscribe(
            (state: any) => state.currentJsonData,
            () => this.scheduleReinterpolate(),
        ) ?? null;
    }

    override setMapInternal(map: OLMap | null): void {
        if (this.moveEndKey) { unByKey(this.moveEndKey); this.moveEndKey = null; }
        super.setMapInternal(map);
        if (map) {
            if (PAVEMENT_MARKING_TILING.ENABLED) {
                this.moveEndKey = map.on('moveend', () => this.updateTiles(map));
                this.updateTiles(map);
            }
        } else {
            this.tileManager?.clear();
            this.tileManager = null;
        }
    }

    private updateTiles(map: OLMap): void {
        const view = map.getView();
        const size = map.getSize();
        const resolution = view.getResolution();
        if (!size || resolution == null) return;
        if (!this.tileManager) {
            const versionId = getActiveVersionId();
            if (!versionId) return;
            this.tileManager = new PavementMarkingTileManager(String(versionId), {
                onTileLoaded: (_k, payload) => { if (this.membership.add(payload)) this.load(); },
                onTileEvicted: (_k, payload) => { if (this.membership.remove(payload)) this.load(); },
            });
        }
        this.tileManager.update(view.calculateExtent(size), resolution);
    }

    /** 보간 실패([0,0]) 상태로 남은 마킹을 차선 타일 로드 후 재보간 (debounce) */
    private scheduleReinterpolate(): void {
        if (this.reinterpolateTimer) return;
        this.reinterpolateTimer = setTimeout(() => {
            this.reinterpolateTimer = null;
            const unresolved = this.source.getFeatures().filter(f => {
                const c = (f.getGeometry() as Point | undefined)?.getCoordinates();
                return !c || (c[0] === 0 && c[1] === 0);
            });
            if (unresolved.length === 0) return;
            interpolateByOffset(unresolved);
            this.changed();
        }, 200);
    }

    public async load(): Promise<void> {
        const store = layerNameToStoreMap[this.LAYER_NAME];
        const currentJsonData = store.getState().currentJsonData;
        if (!currentJsonData) return;
        const { pavementMarkings } = currentJsonData;

        // 타일 모드: viewport 노면표시(서버 최신) + 로컬 미저장 편집을 id 단위로 병합
        //   (Bus/RailStationFeatureLayer와 동일 조치 — diffRecordEditsById 참고).
        // 비-타일 모드: store 전체 노면표시 그대로 사용.
        let markingsAll: PavementMarkingData[];
        if (PAVEMENT_MARKING_TILING.ENABLED) {
            const originData = store.getState().originData as any;
            const { editedIds, deletedIds } = diffRecordEditsById(originData?.pavementMarkings, pavementMarkings, 'id');
            const merged = new Map<string, any>();
            for (const m of this.membership.values()) {
                const id = String(m?.id ?? '');
                if (deletedIds.has(id)) continue;
                merged.set(id, m);
            }
            for (const m of (pavementMarkings ?? [])) {
                const id = String(m?.id ?? '');
                if (editedIds.has(id)) merged.set(id, m);
            }
            markingsAll = [...merged.values()];
        } else {
            markingsAll = pavementMarkings ?? [];
        }

        const source = this.source;
        source.clear();

        const features = markingsAll.map((data) => this.createFeature(data));

        const mergedFeatures = interpolateByOffset(features);
        source.addFeatures(mergedFeatures);
    }

    /**
     * DTO로부터 Point Feature와 속성을 생성
     */
    public createFeature(data: PavementMarkingData): Feature<Point> {
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

    public createDto(): PavementMarkingData {
        const guid = generateGUIDWithType(this.getFeatureType());

        const dto: PavementMarkingData = {
            id: undefined,
            __guid: guid,
            angle: null,
            featureType: FEATURE_TYPE.PAVEMENT_MARKING,
            linkRef: null,
            laneRef: null,
            offset: null,
            coordinates: [{
                lng: null,
                lat: null,
            }],
            markingType: null,
        };

        return dto;
    }

    /**
     * 일반 객체를 DTO 로 변환
     */
    public recordToDto(record: Record<string, unknown>): PavementMarkingData {
        const { geometry, ...cleaned } = record;
        const guid = cleaned.__guid ?? generateGUIDWithType(this.getFeatureType())
        const dto = {
            ...(cleaned as Omit<PavementMarkingData, "featureType" | "__guid">),
            featureType: FEATURE_TYPE.PAVEMENT_MARKING,
            __guid: guid
        } as PavementMarkingData;
        return dto
    }

    /**
     * Snap 된 일반 객체 Property 추출
     */
    public recordToSnapProperties(record: Record<string, unknown>): PavementMarkingSnapProperties | undefined {
        if (record["featureType"] !== this.getSnapFeatureType()) return;

        const properties: Partial<PavementMarkingSnapProperties> = {};

        PAVEMENT_MARKING_SNAP_FIELDS.forEach(field => {
            const v = record[field];
            if (v != null) {
                if (field === '__guid' || field === 'id') {
                    properties[field] = String(v); // string 유지
                } else {
                    properties[field] = Number(v); // 나머지는 number로 변환
                }
            }
        });

        // 아무 필드도 채워지지 않았다면 undefined 반환
        if (Object.keys(properties).length === 0) {
            return undefined;
        }

        return properties as PavementMarkingSnapProperties;
    }


    /**
     * Snap 속성을 기존 BusStationData에 병합
     */
    public snapPropertiesToDto(
        snapProperties: PavementMarkingSnapProperties,
        baseDto: PavementMarkingData
    ): PavementMarkingData {
        const { id: ignored, ...props } = snapProperties
        return {
            ...baseDto,
            ...props
        };
    }
    /**
     * Snap 대상 레이어 키
     */
    public getSnapLayerKey(): string {
        return SNAP_LAYER;
    }

    /**
     * Snap 대상 featureType
     */
    public getSnapFeatureType(): string {
        return SNAP_FEATURE_TYPE;
    }

    public getFeatureType(): string {
        return FEATURE_TYPE.PAVEMENT_MARKING;
    }

    public computeMetadata(
        targetFeature: Feature<Geometry>,
        basedProperties: Record<string, unknown> | undefined,
        fromCoord: Coordinate,
        drawType?: String,
    ): Record<string, unknown> {
        //const offset = getOffsetByCoordinate(targetFeature, fromCoord);
        const {cellId, offset} = getCellOffsetRelativeToCell(targetFeature, fromCoord);
        const angle = getAngleByCoordinate(targetFeature, fromCoord);
        const computeProperties: Record<string, unknown> = {};
        const [ lng, lat ] = toLonLat(fromCoord)

        PAVEMENT_MARKING_SNAP_FIELDS.forEach((key) => {
            if (key === "offset") {
                computeProperties[key] = offset ?? null;
            } else if (key === "coordinates") {
                computeProperties[key] = lng != null && lat != null ? [ { lat, lng } ] : [];
            } else if (key === "markingType") {
                computeProperties[key] = drawType;
            } else if (key === "cellId") {
                computeProperties[key] = cellId;
            } else if (key === "angle") {
                computeProperties[key] = angle;
            } else {
                computeProperties[key] = basedProperties?.[key] ?? null;
            }
        });

        return computeProperties;
    }

    public destroy() {
        this.unsubscribe();
        this.networkUnsubscribe?.();
        if (this.reinterpolateTimer) {
            clearTimeout(this.reinterpolateTimer);
            this.reinterpolateTimer = null;
        }
        if (this.moveEndKey) { unByKey(this.moveEndKey); this.moveEndKey = null; }
        this.tileManager?.clear();
        this.tileManager = null;
    }
}
