import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { GeoJSON } from "ol/format";
import { useLayerStore } from "@stores/useLayerStore";
import { menuCodeToStoreMap } from "@hooks/useFeatureInit";

export default class BusStationLayer extends WebGLVectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "PT_BUS_STATION"
    private unsubscribe: () => void;
    constructor() {
        const layerStore = useLayerStore.getState();
        const activeLayerName = layerStore.activeLayerName;
        // const isVisible = activeLayerName?.includes("busStation") ?? false;

        const source = new VectorSource();

        super({
            source,
            visible: true,
            style: {
                // selected === 1이면 radius 10, 아니면 radius 6
                "circle-radius":
                    6
                    // "case",
                    // ["==", ["get", "selected"], 1],  // float 1과 비교
                    // 6,
                    // 6
                ,
                "circle-fill-color":
                    'rgba(0,255,0,1)'
                    // "case",c
                    // ["==", ["get", "selected"], 1],
                    // "rgba(0,255,0,1)",
                    // "rgba(255,0,0,1)"
                ,
                "circle-stroke-width": 1
                    // "case",
                    // ["==", ["get", "selected"], 1],
                    // 1,
                    // 1,
                ,
                "circle-stroke-color":
                    'rgba(0,0,0,0.75)'
                    // "case",
                    // ["==", ["get", "selected"], 1],
                    // "rgba(0,0,0,0.75)",  // 선택 시 빨간 테두리
                    // "rgba(0,0,0,0)",    // 비선택 시 투명
                ,
            },
            zIndex: 410,
        });

        const store = menuCodeToStoreMap["PT_BUS_STATION"];
        this.unsubscribe = store.subscribe(
            (state) => state.currentGeojson,
            (geojson) => {
                if (!geojson) return;
                const format = new GeoJSON({ featureProjection: "EPSG:3857" });
                const features = format.readFeatures(geojson);
                features.forEach(f => f.set("selected", 0));
                source.clear(true);
                source.addFeatures(features);
            },
            { fireImmediately: true }
        );
        this.source = source;
    }

    public loadFromStore(): void {
        const store = menuCodeToStoreMap[this.LAYER_NAME]
        const geojson = store.getState().currentGeojson;
        if(!store || !geojson) return;
        try {
            const format = new GeoJSON({ featureProjection: 'EPSG:3857' });
            const features = format.readFeatures(geojson);

            features.forEach(f => f.set("selected", 0));
            this.source.clear(true);
            this.source.addFeatures(features);

        } catch (error) {
            console.error("[BusStationLayer] store 기반 로딩 실패:", error);
        }
    }
    public destroy() {
        this.unsubscribe();
    }
}
