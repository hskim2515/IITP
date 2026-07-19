import {GeoJsonDataSource, Viewer, Color, Cartesian3, Entity} from "cesium";
import {layerNameToStoreMap, menuCodeToStoreMap} from "@hooks/useLayerInit";
import {interpolateByOffset} from "@utils/interpolateByOffset";
import {FEATURE_TYPE, PavementMarkingData, PavementMarkingType} from "@type/PavementMarking";
import {Feature} from "ol";
import {Point} from "ol/geom";
import {fromLonLat} from "ol/proj";
import {convertFeatureToRecord} from "@utils/feature";
import * as Cesium from "cesium";


export default class PavementMarkingDataSourceLayer {
    private readonly LAYER_NAME = "pavementMarking";
    private dataSource: GeoJsonDataSource;
    private unsubscribe: () => void;
    private networkUnsubscribe: (() => void) | null = null;
    private reloadTimer: ReturnType<typeof setTimeout> | null = null;
    /** 보간 실패(차선 타일 미로드)로 스킵된 마킹 존재 여부 — 네트워크 동기화 시 재로드 트리거 */
    private hasUnresolved = false;
    /** load() 재진입 가드 — rotateImage await 중 겹친 이전 로드가 stale dataSource 를 add 하는 것 방지 */
    private loadSeq = 0;

    constructor(private viewer: Viewer) {
        this.dataSource = new GeoJsonDataSource(this.LAYER_NAME);
        const store = layerNameToStoreMap[this.LAYER_NAME];
        this.unsubscribe = store.subscribe(
            (state) => state.currentJsonData,
            async (currentJsonData) => {
                if (!currentJsonData?.pavementMarkings) return;
                try {
                    await this.load(currentJsonData.pavementMarkings);
                } catch (error) {
                    console.error("[PavementMarkingDataSourceLayer] GeoJSON 로드 실패:", error);
                }
            },
            { fireImmediately: true }
        );

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

    private scheduleReload(): void {
        if (this.reloadTimer) return;
        this.reloadTimer = setTimeout(async () => {
            this.reloadTimer = null;
            const markings = (layerNameToStoreMap[this.LAYER_NAME] as any)?.getState().currentJsonData?.pavementMarkings;
            if (!markings?.length) return;
            try {
                await this.load(markings);
            } catch (error) {
                console.error("[PavementMarkingDataSourceLayer] 재보간 로드 실패:", error);
            }
        }, 300);
    }

    private async load(pavementMarkings: Record<string, any>[]): Promise<void> {
        const seq = ++this.loadSeq;
        // 기존 데이터 제거 후 초기화
        this.viewer.dataSources.remove(this.dataSource, true);
        this.dataSource = new GeoJsonDataSource(this.LAYER_NAME);
        const dataSource = this.dataSource;

        const features = pavementMarkings
            .map((data) => this.createFeature(data))
            //.filter((f): f is Feature<Point> => !!f);
        const mergedFeatures = interpolateByOffset(features);

        const flatRows = mergedFeatures
            .map(f => convertFeatureToRecord(f))
            .filter(r => r.id !== undefined && !isNaN(Number(r.id)))
            .sort((a, b) => Number(a.id) - Number(b.id));

        // 보간 실패 마킹([0,0]→toLonLat→lng/lat 0)이 남아 있으면 네트워크 타일 로드 시 재시도 대상
        this.hasUnresolved = flatRows.some(r => {
            const c = r.coordinates?.[0];
            return !c?.lng || !c?.lat;
        });

        for (const pavementMarking of flatRows) {
            const { coordinates, id, selected = 0, markingType, angle } = pavementMarking;
            const coord = coordinates?.[0];
            const lng = coord?.lng;
            const lat = coord?.lat;

            if (!lng || !lat) continue;

            const iconFile = PavementMarkingType[markingType];
            const url = `${ process.env.REACT_APP_FILE_BASE_URL }models/${ iconFile }`;

            const width = 1;
            const length = 2;
            const polygonCoords = this.computeRectangleAround(lng, lat, angle, width, length);
            const rotateImg = await this.rotateImage(url, angle);
            if (seq !== this.loadSeq) return; // 더 새로운 load 가 시작됨 — stale 로드 중단

            dataSource.entities.add({
                id: `pavementMarking-${id}`,
                polygon: {
                    hierarchy: Cesium.Cartesian3.fromDegreesArray(polygonCoords),
                    material: new Cesium.ImageMaterialProperty({
                        image: rotateImg,
                        transparent: true,
                    }),
                    height: 0.1,
                    classificationType: Cesium.ClassificationType.TERRAIN,
                }
            });
        }

        if (seq !== this.loadSeq) return; // stale 로드는 add 하지 않음 (중복 dataSource 방지)
        this.viewer.dataSources.add(dataSource);
        console.log("[PavementMarking] 로드 완료: ", dataSource.entities.values.length);
    }

    public destroy(): void {
        this.unsubscribe?.();
        this.networkUnsubscribe?.();
        if (this.reloadTimer) {
            clearTimeout(this.reloadTimer);
            this.reloadTimer = null;
        }
        this.viewer.dataSources.remove(this.dataSource, true);
    }

    public createFeature(data: PavementMarkingData): Feature<Point> | undefined {
        console.log("createFeature data:::", data);

        const props: PavementMarkingData = {
            ...data,
            featureType: data.featureType ?? FEATURE_TYPE.PAVEMENT_MARKING,
        };
        const geom = new Point([0, 0]); // 임시
        const feature = new Feature<Point>(geom);

        feature.setProperties(props);

        return feature;
    }
    public computeRectangleAround(lng: number, lat: number, angleRad: number, widthMeters: number, lengthMeters: number): [number, number, number, number, number, number, number, number] {
        const center = Cesium.Cartesian3.fromDegrees(lng, lat);
        const enuTransform = Cesium.Transforms.eastNorthUpToFixedFrame(center);

        const halfWidth = widthMeters / 2;
        const halfLength = lengthMeters / 2;

        const localPositions = [
            new Cesium.Cartesian3(-halfWidth,  halfLength, 0),
            new Cesium.Cartesian3( halfWidth,  halfLength, 0),
            new Cesium.Cartesian3( halfWidth, -halfLength, 0),
            new Cesium.Cartesian3(-halfWidth, -halfLength, 0),
        ].map(p => {
            const cos = Math.cos(-angleRad);
            const sin = Math.sin(-angleRad);
            const x = p.x * cos - p.y * sin;
            const y = p.x * sin + p.y * cos;
            return new Cesium.Cartesian3(x, y, 0);
        });
        const worldPositions = localPositions.map(p => Cesium.Matrix4.multiplyByPoint(enuTransform, p, new Cesium.Cartesian3()));
        const degreesArray = worldPositions.map(p => {
            const carto = Cesium.Cartographic.fromCartesian(p);
            return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)];
        }).flat();

        return degreesArray as [number, number, number, number, number, number, number, number];
    }

    public rotateImage(url: string, angleRad: number): Promise<string> {
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


}
