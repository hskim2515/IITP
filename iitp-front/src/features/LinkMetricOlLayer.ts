import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString, Point } from "ol/geom";
import { Stroke, Style, Circle, Fill } from "ol/style";
import { fromLonLat } from "ol/proj";
import { FeatureLike } from "ol/Feature";
import { LinkMetricType } from "@primitives/LinkMetricPolylineLayer";
import { vcToContinuousColorHex, losGradeColor } from "@utils/losScale";

/**
 * `LinkMetricPolylineLayer`(Cesium 3D)의 2D 대응 — 데이터를 직접 fetch하지 않고 외부(LayerManager
 * 조립 시 Cesium 레이어의 onData/onIntersections 콜백)에서 주입받아 그리기만 한다. 같은 집계를
 * 두 지도가 각자 fetch하면 요청이 중복되므로, 데이터는 Cesium 쪽이 한 번만 가져오고 이 레이어는
 * 순수 렌더러로만 동작한다.
 */
export default class LinkMetricOlLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly pointSource: VectorSource;
    private readonly metric: LinkMetricType;

    constructor(metric: LinkMetricType) {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 210,
            style: (feature, resolution) => this.styleFunction(feature, resolution),
        });
        this.metric = metric;
        this.source = source;
        this.pointSource = new VectorSource();
    }

    /** los 레이어의 교차로 포인트 소스 — LayerManager가 별도 VectorLayer로 등록할 때 사용 */
    public getPointSource(): VectorSource {
        return this.pointSource;
    }

    public styleFunction(feature: FeatureLike, _resolution: number): Style {
        const color = feature.get("color") as string;
        const width = feature.get("width") as number;
        return new Style({ stroke: new Stroke({ color, width }) });
    }

    /** LinkMetricPolylineLayer의 onData 콜백에서 호출 — 링크(coordinates/vcRatio/losGrade) 목록 */
    public setData(links: any[]): void {
        const features: Feature[] = [];
        for (const l of links) {
            const coords = l.coordinates;
            if (!coords || coords.length < 2) continue;
            const olCoords = coords
                .filter((c: any) => c && isFinite(c.lng) && isFinite(c.lat))
                .map((c: any) => fromLonLat([c.lng, c.lat]));
            if (olCoords.length < 2) continue;

            const vc = l.vcRatio ?? -1;
            const color = this.metric === "los"
                ? losGradeColor(l.losGrade)
                : this.metric === "bottleneck"
                    ? "#dc2626"
                    : vcToContinuousColorHex(vc);
            const width = this.metric === "bottleneck" ? 5 : 3;

            const f = new Feature(new LineString(olCoords));
            f.setProperties({ linkId: l.linkId, vcRatio: vc, losGrade: l.losGrade, color, width, featureType: this.metric });
            features.push(f);
        }
        this.source.clear();
        this.source.addFeatures(features);
    }

    /** LinkMetricPolylineLayer의 onIntersections 콜백에서 호출 — 신호교차로 LOS 목록 (los 전용) */
    public setIntersections(items: any[]): void {
        const features: Feature[] = [];
        for (const it of items) {
            if (it.lng == null || it.lat == null) continue;
            const f = new Feature(new Point(fromLonLat([it.lng, it.lat])));
            f.setProperties({ nodeId: it.nodeId, losGrade: it.losGrade, featureType: "los-intersection" });
            features.push(f);
        }
        this.pointSource.clear();
        this.pointSource.addFeatures(features);
    }

    public dispose(): void {
        this.source.clear();
        this.pointSource.clear();
        super.dispose();
    }
}

/** los 교차로 포인트 전용 스타일 (VectorLayer 생성 시 style 함수로 사용) */
export function intersectionPointStyle(feature: FeatureLike): Style {
    const grade = feature.get("losGrade") as string | undefined;
    return new Style({
        image: new Circle({
            radius: 7,
            fill: new Fill({ color: losGradeColor(grade) }),
            stroke: new Stroke({ color: "#ffffff", width: 2 }),
        }),
    });
}
