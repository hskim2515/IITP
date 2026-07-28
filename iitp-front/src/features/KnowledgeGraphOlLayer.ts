import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString, Point } from "ol/geom";
import { Circle, Fill, Stroke, Style, Text } from "ol/style";
import { fromLonLat } from "ol/proj";
import { FeatureLike } from "ol/Feature";
import { GraphType } from "@primitives/KnowledgeGraphLayer";
import { losGradeColor } from "@utils/losScale";

const REGION_NODE_COLOR = "#8b5cf6";

/**
 * `KnowledgeGraphLayer`(Cesium 3D)의 2D 대응 — 데이터는 Cesium 레이어의 onData 콜백으로 공유받는다
 * (중복 fetch 방지). 곡선(포물선) 엣지는 OL에 대응 프리미티브가 없어 직선으로 단순화
 * (`LinkMetricOlLayer`가 3D 컬럼을 생략한 것과 동일한 완화).
 */
export default class KnowledgeGraphOlLayer extends VectorLayer {
    public readonly source: VectorSource; // 엣지(선)
    private readonly pointSource: VectorSource; // 노드(원)
    private readonly graphType: GraphType;

    constructor(graphType: GraphType) {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 215,
            style: (feature) => this.edgeStyleFunction(feature),
        });
        this.graphType = graphType;
        this.source = source;
        this.pointSource = new VectorSource();
    }

    /** 노드(원) 전용 VectorSource — LayerManager가 별도 VectorLayer로 등록할 때 사용 */
    public getPointSource(): VectorSource {
        return this.pointSource;
    }

    public nodeStyleFunction(feature: FeatureLike): Style {
        const color = feature.get("color") as string;
        const label = feature.get("label") as string;
        return new Style({
            image: new Circle({
                radius: feature.get("radius") ?? 8,
                fill: new Fill({ color }),
                stroke: new Stroke({ color: "#ffffff", width: 2 }),
            }),
            text: new Text({
                text: label,
                font: "11px sans-serif",
                offsetY: -14,
                fill: new Fill({ color: "#ffffff" }),
                stroke: new Stroke({ color: "#000000", width: 3 }),
            }),
        });
    }

    private edgeStyleFunction(feature: FeatureLike): Style {
        const density = (feature.get("density") as number) ?? 0.3;
        const width = 1.5 + density * 4;
        const color = this.graphType === "regionOd" ? REGION_NODE_COLOR : "#ef4444";
        return new Style({ stroke: new Stroke({ color, width, lineDash: [6, 4] }) });
    }

    /** KnowledgeGraphLayer의 onData 콜백에서 호출 */
    public setData(nodes: any[], edges: any[]): void {
        const pointFeatures: Feature[] = [];
        const byKey = new Map<string, any>();
        if (this.graphType === "regionOd") {
            const maxVolume = Math.max(1, ...nodes.map((n) => n.totalVolume ?? 0));
            for (const nd of nodes) {
                if (!nd.centroid) continue;
                byKey.set(nd.code, nd);
                const f = new Feature(new Point(fromLonLat(nd.centroid)));
                f.setProperties({
                    color: REGION_NODE_COLOR,
                    radius: 6 + ((nd.totalVolume ?? 0) / maxVolume) * 14,
                    label: `${nd.name ?? nd.code}\n${(nd.totalVolume ?? 0).toLocaleString()}대`,
                });
                f.setStyle(this.nodeStyleFunction(f));
                pointFeatures.push(f);
            }
        } else {
            for (const nd of nodes) {
                if (!nd.centroid) continue;
                byKey.set(nd.linkId, nd);
                const f = new Feature(new Point(fromLonLat(nd.centroid)));
                f.setProperties({
                    color: losGradeColor(nd.losGrade),
                    radius: 8,
                    label: `V/C ${(nd.vcRatio ?? 0).toFixed(2)}`,
                });
                f.setStyle(this.nodeStyleFunction(f));
                pointFeatures.push(f);
            }
        }

        const edgeFeatures: Feature[] = [];
        const maxEdgeVolume = Math.max(1, ...edges.map((e: any) => e.volume ?? 0));
        for (const ed of edges) {
            const from = byKey.get(ed.from);
            const to = byKey.get(ed.to);
            if (!from?.centroid || !to?.centroid) continue;
            const density = this.graphType === "regionOd"
                ? Math.min(1, (ed.volume ?? 0) / maxEdgeVolume)
                : Math.min(1, ((from.vcRatio ?? 0) + (to.vcRatio ?? 0)) / 2);
            const f = new Feature(new LineString([fromLonLat(from.centroid), fromLonLat(to.centroid)]));
            f.setProperties({ density });
            edgeFeatures.push(f);
        }

        this.pointSource.clear();
        this.pointSource.addFeatures(pointFeatures);
        this.source.clear();
        this.source.addFeatures(edgeFeatures);
    }

    public dispose(): void {
        this.source.clear();
        this.pointSource.clear();
        super.dispose();
    }
}
