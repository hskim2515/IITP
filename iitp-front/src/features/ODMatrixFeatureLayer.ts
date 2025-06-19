import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Geometry, Polygon } from "ol/geom";
import { fromLonLat } from "ol/proj";
import { useLayerStore } from "@stores/useLayerStore";

export interface ODData {
    count: number;
    density: number;
    fromCoord: [number, number]; // [127.385, 36.375]
    fromKey: string;             // "12738_3637"
    toCoord: [number, number];   // [127.395, 36.375]
    toKey: string;               // "12739_3637"
}

export default class ODMatrixFeatureLayer extends WebGLVectorLayer {
    private source: VectorSource;
    private odData: ODData[] = [];
    private features: Feature<Geometry>[] = [];
    private speed: number = 1;
    private running: boolean = false;

    constructor(vehicleRoute: any[], speed: number, running: boolean) {
        const layerStore = useLayerStore.getState();
        const activeLayerName = layerStore.activeLayerName;
        const isVisible = activeLayerName?.includes("od") ?? false;

        const source = new VectorSource();
        const style = {
            "fill-color": [
                "interpolate", ["linear"], ["get", "density"],
                0.0, 'rgba(255, 255, 0, 0.4)',
                0.5, 'rgba(255, 140, 0, 0.7)',
                1.0, 'rgba(255, 0, 0, 1.0)'
            ],
        };

        super({
            source: source,
            style,
            visible: isVisible,
            zIndex: 320,
        });

        this.source = source;
        this.speed = speed;
        this.running = running;

        if (this.running) this.start();
    }

    private createTrapezoid(from: number[], to: number[], density: number): number[][] {
        const dx = to[0] - from[0];
        const dy = to[1] - from[1];
        let len = Math.sqrt(dx * dx + dy * dy);

        if (!isFinite(len) || len === 0) {
            to = [from[0] + 1, from[1]];
            len = 1;
        }

        const width = Math.max(10.0, density * 100);

        const unit = [dx / len, dy / len];
        const normal = [-unit[1], unit[0]];

        const leftFrom = [from[0] + normal[0] * width, from[1] + normal[1] * width];
        const rightFrom = [from[0] - normal[0] * width, from[1] - normal[1] * width];
        const leftTo = [to[0] + normal[0] * width * 0.1, to[1] + normal[1] * width * 0.1];
        const rightTo = [to[0] - normal[0] * width * 0.1, to[1] - normal[1] * width * 0.1];

        return [leftFrom, leftTo, rightTo, rightFrom, leftFrom];
    }
    public setLatestPositions(latestPositions: Array<number[] | undefined>) {

    }
    private createResources() {

        this.features = this.odData.map((od) => {
            const from = fromLonLat(od.fromCoord);
            const to = fromLonLat(od.toCoord);
            const trapezoid = this.createTrapezoid(from, to, od.density);

            const polygon = new Polygon([trapezoid]);
            const feature = new Feature({
                geometry: polygon,
                density: od.density
            });

            // Key 설정
            feature.set("fromKey", od.fromKey);
            feature.set("toKey", od.toKey);

            return feature;
        }).filter((f): f is Feature<Geometry> => f !== null);

        this.source.clear();
        this.source.addFeatures(this.features);

    }

    public setOdData(odData: ODData[]) {
        this.odData = odData;

        const newFeatures: Feature<Geometry>[] = [];
        const existingFeatureMap = new Map<string, Feature<Geometry>>();
        const newOdMap = new Map<string, ODData>();

        // 기존 features에서 toKey 기준으로 매핑
        this.features.forEach((f) => {
            const toKey = f.get("toKey");
            if (toKey) {
                existingFeatureMap.set(toKey, f);
            }
        });

        // 새로운 OD 데이터를 순회
        odData.forEach((od) => {
            const toKey = od.toKey;
            const from = fromLonLat(od.fromCoord);
            const to = fromLonLat(od.toCoord);
            const coords = this.createTrapezoid(from, to, od.density);

            const existing = existingFeatureMap.get(toKey);
            if (existing) {
                // 재사용: 좌표만 변경
                existing.set("fromKey", od.fromKey);
                existing.set("density", od.density);
                (existing.getGeometry() as Polygon).setCoordinates([coords]);
                existing.changed();
                newFeatures.push(existing);
                existingFeatureMap.delete(toKey);
            } else {
                // 신규 생성
                const polygon = new Polygon([coords]);
                const feature = new Feature({
                    geometry: polygon,
                    density: od.density
                });
                feature.set("fromKey", od.fromKey);
                feature.set("toKey", od.toKey);
                newFeatures.push(feature);
            }

            newOdMap.set(toKey, od);
        });

        // 제거 대상 처리
        existingFeatureMap.forEach((unusedFeature) => {
            this.source.removeFeature(unusedFeature);
        });

        this.features = newFeatures;
        this.source.clear();
        this.source.addFeatures(newFeatures);
    }

    public setSpeed(speed: number) {
        this.speed = speed;
    }

    public setStatus(isRunning: boolean) {
        this.running = isRunning;
    }

    public start() {
        this.setStatus(true);
    }

    public stop() {
        this.setStatus(false);
    }

    public destroy() {
        console.log("ODMatrixFeatureLayer:::destroy");
        this.source.clear();
        this.source.refresh();
        this.running = false;
    }
}
