import WebGLVectorLayer from "ol/layer/WebGLVector";
import VectorSource from "ol/source/Vector";
import { GeoJSON } from "ol/format";
import { useLayerStore } from "@stores/useLayerStore";
import { menuCodeToStoreMap } from "@hooks/useFeatureInit";
import { Feature } from "ol";
import { Icon, Style } from "ol/style";
import VectorLayer from "ol/layer/Vector";

// export default class BusStationLayer extends VectorLayer {
export default class BusStationLayer extends WebGLVectorLayer {
    public readonly source: VectorSource;
    private readonly LAYER_NAME = "PT_BUS_STATION"
    private readonly TRANSIT_MODE = "bus"
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
                // selected === 1이면 radius 8, 아니면 radius 6
                "circle-radius":
                    [                "case",
                        ["==", ["get", "selected"], 1],
                        8, // selected 1
                        6 // selected 0
                    ]
                ,
                "circle-fill-color":

                    [                "case",
                        ["==", ["get", "selected"], 1],
                        "rgba(0,255,0,1)", // selected 1
                        "rgba(255,0,0,1)"
                    ]
                ,
                "circle-stroke-width":
                    [ "case",
                        [ "==", [ "get", "selected" ], 1 ],
                        1, // selected 1
                        1,
                    ]
                ,
                "circle-stroke-color":
                    [ "case",
                        [ "==", [ "get", "selected" ], 1 ],
                        "rgb(255,0,0)", // selected 1
                        "rgba(0,0,0,0)",
                    ]
                ,
            },
            zIndex: 410,
        });
// VectorLayer 일 때, 적용 가능한 동적 style
// super({
//     source,
//     visible: true,
//     style: (feature: Feature, resolution: number) => {
//         const baseResolution = 1.2;
//         const scale = 0.05 * (baseResolution/resolution);
//
//         return new Style({
//             image: new Icon({
//                 src: "/public/bus_stop.png",
//                 scale: scale,
//                 rotateWithView: true,
//             }),
//         });
//     },
//     updateWhileAnimating: true,
//     updateWhileInteracting: true,
//     zIndex: 410,
// });
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
        if (!store || !geojson) return;
        try {
            const format = new GeoJSON({ featureProjection: 'EPSG:3857' });
            const features = format.readFeatures(geojson);

            // WebGLVectorLayer Style 을 위해 selected 속성을 정의
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