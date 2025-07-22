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
    }

    private async load(pavementMarkings: Record<string, any>[]): Promise<void> {
        // 기존 데이터 제거 후 초기화
        this.viewer.dataSources.remove(this.dataSource, true);
        this.dataSource = new GeoJsonDataSource(this.LAYER_NAME);

        const features = pavementMarkings
            .map((data) => this.createFeature(data))
            .filter((f): f is Feature<Point> => !!f);
        const mergedFeatures = interpolateByOffset(features);

        const flatRows = mergedFeatures
            .map(f => convertFeatureToRecord(f))
            .filter(r => r.id !== undefined && !isNaN(Number(r.id)))
            .sort((a, b) => Number(a.id) - Number(b.id));

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

            this.dataSource.entities.add({
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

        this.viewer.dataSources.add(this.dataSource);
        console.log("[PavementMarking] 로드 완료: ", this.dataSource.entities.values.length);
    }

    public destroy(): void {
        this.unsubscribe?.();
        this.viewer.dataSources.remove(this.dataSource, true);
    }

    public createFeature(data: PavementMarkingData): Feature<Point> | undefined {
        console.log("createFeature data:::", data);

        const props: PavementMarkingData = {
            ...data,
            featureType: data.featureType ?? FEATURE_TYPE.PAVEMENT_MARKING,
        };
        const coord = Array.isArray(data.coordinates) ? data.coordinates[0] : undefined;
        const hasValidCoordinate =
            coord &&
            typeof coord.lng === 'number' &&
            typeof coord.lat === 'number';

        if (!hasValidCoordinate) {
            console.warn("Invalid or missing coordinates, skipping feature:", data);
            return undefined;
        }

        const geom = new Point(fromLonLat([coord.lng!, coord.lat!]));
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
