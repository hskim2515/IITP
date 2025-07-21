import {Point} from "ol/geom";
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import {convertFeatureToRecord, createFeature} from "@utils/feature";
import {Feature} from "ol";

export function interpolateByOffset(features: any[]): any[] {
    const olMap = useOpenLayersStore.getState().map;
    const layers = olMap.getLayers().getArray();
    const networkLayer = layers.find(layer => layer.LAYER_NAME === "network");

    const networkFeatures = networkLayer.getSource().getFeatures();
    const laneMap = new Map<string, any>();
    networkFeatures.forEach(f => {
        const props = f.getProperties();
        if (props?.featureType === "lane-edit") {
            laneMap.set(`${props.linkRef}_${props.laneRef}`, f);
        }
    });

    features.forEach(f => {
        const linkRef = f.get('linkRef');
        const laneRef = Number(f.get('laneRef'));
        const cellId = Number(f.get('cellId'));
        const offset = Number(f.get('offset'));

        const matched = laneMap.get(`${linkRef}_${laneRef}`);
        if (!matched) return;

        const cells = matched?.get('cells');
        if (!cells || cellId >= cells.length) return;

        const coordinates = matched.getGeometry().getCoordinates();
        let totalOffset = 0;
        for (let i = 0; i < cellId; i++) {
            totalOffset += Number(cells[i]?.length || 0);
        }
        totalOffset += offset;

        const result = interpolateAlongLine(coordinates, totalOffset);
        if (result) {
            const { point, angle } = result;
            f.setGeometry(new Point(point));
            f.set("angle", angle);
        }
    });

    return features;
}

function interpolateAlongLine(coords: number[][], offset: number): { point: [number, number]; angle: number } | null {
    let accumulated = 0;
    for (let i = 1; i < coords.length; i++) {
        const [x1, y1] = coords[i - 1];
        const [x2, y2] = coords[i];
        const segLen = Math.hypot(x2 - x1, y2 - y1);

        if (accumulated + segLen >= offset) {
            const ratio = (offset - accumulated) / segLen;
            const x = x1 + ratio * (x2 - x1);
            const y = y1 + ratio * (y2 - y1);
            const angle = Math.atan2(x2 - x1, y2 - y1);
            return { point: [x, y], angle };
        }
        accumulated += segLen;
    }
    return null;
}

export function interpolateAndConvertToRecords(dataList: any[]): any[] {
    const features = dataList
        .map(data => createFeature(data))
        .filter((f): f is Feature => f !== undefined);

    const interpolated = interpolateByOffset(features);
    return interpolated.map(convertFeatureToRecord);
}
