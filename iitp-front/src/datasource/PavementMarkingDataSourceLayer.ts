import * as Cesium from "cesium";
import {Viewer, CustomDataSource} from "cesium";
import {layerNameToStoreMap} from "@hooks/useLayerInit";
import {interpolateByOffset} from "@utils/interpolateByOffset";
import {FEATURE_TYPE, PavementMarkingData, PavementMarkingType} from "@type/PavementMarking";
import {Feature} from "ol";
import {Point} from "ol/geom";
import {toLonLat} from "ol/proj";
import {buildFileUrl} from "@utils/fileUrl";

export default class PavementMarkingDataSourceLayer {
    private readonly LAYER_NAME = "pavementMarking";
    public readonly dataSource: CustomDataSource;
    private unsubscribes: (() => void)[] = [];
    private isVisible: boolean = true;
    private needsReload: boolean = false;

    constructor(private viewer: Viewer) {
        this.dataSource = new CustomDataSource(this.LAYER_NAME);
        this.viewer.dataSources.add(this.dataSource);

        const store = layerNameToStoreMap[this.LAYER_NAME];
        if (store) {
            this.unsubscribes.push(store.subscribe(
                (state) => state.currentJsonData,
                async (currentJsonData) => {
                    if (!currentJsonData?.pavementMarkings) return;
                    await this.load(currentJsonData.pavementMarkings);
                },
                { fireImmediately: true }
            ));
        }

        const networkStore = layerNameToStoreMap["network"];
        if (networkStore) {
            this.unsubscribes.push(networkStore.subscribe(
                (state) => state.currentJsonData,
                async () => {
                    const data = store?.getState().currentJsonData?.pavementMarkings;
                    if (data) await this.load(data);
                }
            ));
        }
    }

    public setVisible(visible: boolean): void {
        this.isVisible = visible;
        this.dataSource.show = visible;
        if (visible && this.needsReload) {
            const store = layerNameToStoreMap[this.LAYER_NAME];
            const data = store.getState().currentJsonData?.pavementMarkings;
            if (data) this.load(data);
        }
    }

    private async load(pavementMarkings: Record<string, any>[]): Promise<void> {
        if (!this.isVisible) {
            this.needsReload = true;
            return;
        }
        this.needsReload = false;
        this.dataSource.entities.removeAll();

        const features = pavementMarkings.map((data) => this.createFeature(data as any));
        const mergedFeatures = interpolateByOffset(features);

        for (const feature of mergedFeatures) {
            const props = feature.getProperties() as PavementMarkingData;
            const geom = feature.getGeometry() as Point;
            if (!geom) continue;

            const coords = geom.getCoordinates();
            const [lng, lat] = toLonLat(coords);
            const angle = feature.get("angle") || 0;

            if (lng == null || lat == null || isNaN(lng) || isNaN(lat) || (Math.abs(lng) < 0.0001 && Math.abs(lat) < 0.0001)) continue;

            const iconFile = PavementMarkingType[props.markingType || ""];
            if (!iconFile) continue;
            const url = buildFileUrl(`models/${ iconFile }`);

            const width = 2.0;
            const length = 4.0;
            const entityId = props.id ?? props.__guid;

            try {
                // 각도 중복 적용 방지
                const rotateImg = await this.rotateImage(url, 0);
                const polygonCoords = this.computeRectangleAround(lng, lat, angle, width, length);

                this.dataSource.entities.add({
                    id: `pavementMarking-${entityId}`,
                    polygon: {
                        hierarchy: new Cesium.PolygonHierarchy(
                            Cesium.Cartesian3.fromDegreesArray(polygonCoords)
                        ),
                        material: new Cesium.ImageMaterialProperty({
                            image: rotateImg,
                            transparent: true,
                        }),
                        classificationType: Cesium.ClassificationType.BOTH,
                        zIndex: 400
                    },
                    properties: props
                } as any);
            } catch (e) {
                console.error(`[PavementMarking] Entity 추가 실패 (${entityId}):`, e);
            }
        }

        console.log(`[PavementMarking] Cesium 로드 완료: ${this.dataSource.entities.values.length}개`);
        this.viewer.scene.requestRender();
    }

    public destroy(): void {
        this.unsubscribes.forEach(u => u());
        this.unsubscribes = [];
        this.viewer.dataSources.remove(this.dataSource, true);
    }

    public createFeature(data: PavementMarkingData): Feature<Point> {
        const props: PavementMarkingData = {
            ...data,
            featureType: data.featureType ?? FEATURE_TYPE.PAVEMENT_MARKING,
        };
        const feature = new Feature<Point>(new Point([0, 0]));
        feature.setProperties(props);
        return feature;
    }

    public computeRectangleAround(lng: number, lat: number, angleRad: number, widthMeters: number, lengthMeters: number): number[] {
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
        return worldPositions.flatMap(p => {
            const carto = Cesium.Cartographic.fromCartesian(p);
            return [Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude)];
        });
    }

    public rotateImage(url: string, angleRad: number): Promise<string | HTMLCanvasElement> {
        if (angleRad === 0) return Promise.resolve(url);
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = url;
            img.onload = () => {
                const canvas = document.createElement("canvas");
                const size = Math.max(img.width, img.height);
                canvas.width = size; canvas.height = size;
                const ctx = canvas.getContext("2d");
                if (!ctx) return reject("Canvas context error");
                ctx.translate(size / 2, size / 2);
                ctx.rotate(angleRad);
                ctx.drawImage(img, -img.width / 2, -img.height / 2);
                resolve(canvas);
            };
            img.onerror = reject;
        });
    }
}
