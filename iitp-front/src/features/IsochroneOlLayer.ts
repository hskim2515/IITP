import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString, Point } from "ol/geom";
import { Circle, Fill, Stroke, Style } from "ol/style";
import { fromLonLat } from "ol/proj";
import { FeatureLike } from "ol/Feature";
import { coverageColorHex } from "@utils/losScale";

const FACILITY_COLOR: Record<string, string> = {
    bus: "#f97316",
    rail: "#1e3a8a",
};

/**
 * `IsochroneLayer`(Cesium 3D, 시설 서비스권 커버리지)의 2D 대응 — 순수 렌더러: onData 콜백으로
 * 받은 응답을 커버리지 색칠된 선 + 시설 마커로 그린다.
 */
export default class IsochroneOlLayer extends VectorLayer {
    public readonly source: VectorSource; // 커버리지 링크(선)
    private readonly facilitySource: VectorSource; // 시설 마커

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 220,
            style: (feature) => this.edgeStyleFunction(feature),
        });
        this.source = source;
        this.facilitySource = new VectorSource();
    }

    /** 시설 마커 전용 VectorSource — LayerManager가 별도 VectorLayer로 등록할 때 사용 */
    public getFacilitySource(): VectorSource {
        return this.facilitySource;
    }

    private edgeStyleFunction(feature: FeatureLike): Style {
        const color = (feature.get("color") as string) ?? "#9ca3af";
        return new Style({ stroke: new Stroke({ color, width: 3 }) });
    }

    public facilityStyleFunction(feature: FeatureLike): Style {
        const type = feature.get("facilityType") as string;
        return new Style({
            image: new Circle({
                radius: 5,
                fill: new Fill({ color: FACILITY_COLOR[type] ?? "#ffffff" }),
                stroke: new Stroke({ color: "#ffffff", width: 1.5 }),
            }),
        });
    }

    /** IsochroneLayer의 onData 콜백에서 호출 */
    public setData(data: any): void {
        const links: any[] = data?.links ?? [];
        const facilities: any[] = data?.facilities ?? [];
        const maxCount = Math.max(1, ...links.map((l) => l.coverageCount ?? 0));

        const features: Feature[] = [];
        for (const l of links) {
            const coords = l.coordinates;
            if (!coords || coords.length < 2) continue;
            const olCoords = coords
                .filter((c: any) => c && isFinite(c.lng) && isFinite(c.lat))
                .map((c: any) => fromLonLat([c.lng, c.lat]));
            if (olCoords.length < 2) continue;
            const f = new Feature(new LineString(olCoords));
            f.setProperties({ color: coverageColorHex(l.coverageCount ?? 0, maxCount) });
            features.push(f);
        }
        this.source.clear();
        this.source.addFeatures(features);

        const facilityFeatures: Feature[] = [];
        for (const fac of facilities) {
            if (fac.lng == null || fac.lat == null) continue;
            const f = new Feature(new Point(fromLonLat([fac.lng, fac.lat])));
            f.setProperties({ facilityType: fac.type });
            facilityFeatures.push(f);
        }
        this.facilitySource.clear();
        this.facilitySource.addFeatures(facilityFeatures);
    }

    public dispose(): void {
        this.source.clear();
        this.facilitySource.clear();
        super.dispose();
    }
}
