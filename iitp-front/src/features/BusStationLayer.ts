import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { GeoJSON as GeoJSONFormat } from "ol/format";
import { Feature } from "ol";
import { Fill, Stroke, Circle as CircleStyle, Style } from "ol/style";
import { menuCodeToStoreMap } from "@hooks/useFeatureInit";

export default class BusStationLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "PT_BUS_STATION";
    private unsubscribe: () => void;

    public readonly defaultStyle = new Style({
        image: new CircleStyle({
            radius: 6,
            fill: new Fill({ color: "rgba(255,0,0,1)" }),
            stroke: new Stroke({ color: "rgba(0,0,0,0)", width: 1 }),
        }),
    })

    public readonly selectedStyle = new Style({
        image: new CircleStyle({
            radius: 8,
            fill: new Fill({ color: "rgba(0,255,0,1)" }),
            stroke: new Stroke({ color: "rgba(255,0,0,0)", width: 1 }),
        }),
    })

    //
    // default style && selected Style


    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: true,
            zIndex: 410,
            // updateWhileAnimating: true,
            style: new Style({
                image: new CircleStyle({
                    radius: 6,
                    fill: new Fill({ color: "rgba(255,0,0,1)" }),
                    stroke: new Stroke({ color: "rgba(0,0,0,0)", width: 1 }),
                }),
            }),
        });

        this.source = source;

        // Store 구독: 모든 변경(add/delete/modify)에 대해 diff 업데이트
        const store = menuCodeToStoreMap[this.LAYER_NAME];
        this.unsubscribe = store.subscribe(
            (state) => state.currentGeojson,
            (geojson) => {
                if (!geojson) return;
                this.applyDiffUpdate(geojson);
            },
            { fireImmediately: true }
        );
    }

    /**
     * GeoJSON FeatureCollection을 받아 source를 ID 기반으로 diff 업데이트
     */
    private applyDiffUpdate(geojson: GeoJSON.FeatureCollection) {
        const format = new GeoJSONFormat({ featureProjection: "EPSG:3857" });
        const incoming = format.readFeatures(geojson) as Feature[];

        // 현재 소스의 피처들을 ID 맵으로
        const existingFeatures = this.source.getFeatures();
        const existingById = new Map<number | string, Feature>();
        existingFeatures.forEach((f) => {
            const id = f.get("id");
            if (id !== undefined) existingById.set(id, f);
        });

        // incoming 피처들을 ID 맵으로
        const incomingById = new Map<number | string, Feature>();
        incoming.forEach((f) => {
            const id = f.get("id");
            if (id !== undefined) incomingById.set(id, f);
        });

        // 1) 삭제: 기존에는 있는데 incoming에 없는 ID
        existingFeatures.forEach((f) => {
            const id = f.get("id");
            if (id !== undefined && !incomingById.has(id)) {
                this.source.removeFeature(f);
            }
        });

        // 2) 추가: incoming에 있는데 기존에 없는 ID
        incoming.forEach((newF) => {
            const id = newF.get("id");
            if (id !== undefined && !existingById.has(id)) {
                this.source.addFeature(newF);
            }
        });

        // 3) 수정: 양쪽에 모두 있는 ID
        incomingById.forEach((newF, id) => {
            const oldF = existingById.get(id);
            if (oldF) {
                // geometry만 교체
                const newGeom = newF.getGeometry();
                if (newGeom) {
                    oldF.getGeometry()!.setCoordinates(newGeom.getCoordinates());
                }
                // 속성 업데이트
                const props = newF.getProperties();
                Object.keys(props).forEach((key) => {
                    if (key !== "geometry") {
                        oldF.set(key, props[key]);
                    }
                });
                oldF.changed();
            }
        });
    }

    /**
     * 초기 로드 또는 수동 호출 시에도 diff 업데이트 사용
     */
    public loadFromStore(): void {
        const store = menuCodeToStoreMap[this.LAYER_NAME];
        const geojson = store.getState().currentGeojson;
        if (geojson) {
            this.applyDiffUpdate(geojson);
        }
    }

    /** 레이어 제거 시 구독 해제 */
    public destroy(): void {
        this.unsubscribe();
    }
}
