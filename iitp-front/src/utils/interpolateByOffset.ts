import {Point} from "ol/geom";
import {toLonLat} from "ol/proj";
import {getDistance} from "ol/sphere";
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import {convertFeatureToRecord, createFeature} from "@utils/feature";
import {Feature} from "ol";

export function interpolateByOffset(features: any[]): any[] {
    const olMap = useOpenLayersStore.getState().map;
    if (!olMap) {
        console.warn('[interpolateByOffset] OL map not ready, skipping interpolation');
        return features;
    }
    const layers = olMap.getLayers().getArray();
    const networkLayer = layers.find((layer: any) => layer.LAYER_NAME === "network");

    if (!networkLayer) {
        console.warn('[interpolateByOffset] network layer not found, skipping interpolation');
        return features;
    }

    const networkFeatures = (networkLayer as any).getSource().getFeatures();
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

// 단일용 래퍼 함수
export function interpolateFeatureByOffset(feature: Feature): Feature {
    const [result] = interpolateByOffset([feature]);
    return result;
}

function interpolateAlongLine(coords: number[][], offset: number): { point: [number, number]; angle: number } | null {
    let accumulated = 0;
    for (let i = 1; i < coords.length; i++) {
        const [x1, y1] = coords[i - 1];
        const [x2, y2] = coords[i];
        // 지오메트리는 EPSG:3857인데 offset(셀 length 합)은 실제 미터 —
        // 메르카토르 평면거리(hypot)는 위도 37°에서 실제의 ~1.25배라 실제 거리로 누적해야 함
        const segLen = getDistance(toLonLat([x1, y1]), toLonLat([x2, y2]));
        if (segLen === 0) continue;

        if (accumulated + segLen >= offset) {
            const ratio = (offset - accumulated) / segLen;
            const x = x1 + ratio * (x2 - x1);
            const y = y1 + ratio * (y2 - y1);
            const angle = Math.atan2(x2 - x1, y2 - y1);
            return { point: [x, y], angle };
        }
        accumulated += segLen;
    }
    // offset이 셀 길이 합 오차 등으로 지오메트리 전체 길이를 살짝 넘으면 끝점으로 클램프
    if (coords.length >= 2) {
        const [x1, y1] = coords[coords.length - 2];
        const [x2, y2] = coords[coords.length - 1];
        return { point: [x2, y2], angle: Math.atan2(x2 - x1, y2 - y1) };
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
