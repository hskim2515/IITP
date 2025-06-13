// NetworkLayer.ts
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { LineString, Point, Polygon } from "ol/geom";
import { Fill, Stroke, Style, RegularShape } from "ol/style";
import { fromLonLat } from "ol/proj";

export default class NetworkLayer extends VectorLayer {
    public readonly source: VectorSource;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: true,
            style: (feature, resolution) => this.styleFunction(feature, resolution),
            zIndex: 300,
        });
        this.source = source;
    }

    private styleFunction(feature: Feature, resolution: number): Style[] {
        const props = feature.get("properties") ?? {};
        const geom = feature.getGeometry();
        const styles: Style[] = [];

        if (geom instanceof Polygon && props.featureType === "lane") {
            styles.push(new Style({
                fill: new Fill({ color: "#7f7f7f" }),
                stroke: new Stroke({ color: "#ffffff", width: Math.min(2, 0.5 / resolution) }),
            }));
        }

        if (geom instanceof LineString && props.featureType === "lane-line") {
            styles.push(new Style({
                stroke: new Stroke({ color: "#003cff", width: Math.min(3, 0.5 / resolution) }),
            }));
        }

        if (geom instanceof Polygon && props.featureType === "connection") {
            styles.push(new Style({
                fill: new Fill({ color: "rgba(0,0,0,0.3)" }),
            }));
        }

        if (geom instanceof LineString && props.featureType === "connection-line") {
            const { turning, fromNodeType } = props;
            let color = "#ffffff";
            if (fromNodeType === "intersection") {
                color = turning === "S" ? "#00ffff" : "#ffff00";
            }

            styles.push(new Style({
                stroke: new Stroke({ color, width: Math.min(3, 0.5 / resolution) }),
            }));

            const coordinates = geom.getCoordinates();
            if (coordinates.length >= 2) {
                const [start, end] = [coordinates[coordinates.length - 2], coordinates[coordinates.length - 1]];
                const dx = end[0] - start[0];
                const dy = end[1] - start[1];
                const rotation = Math.atan2(dy, dx);

                styles.push(new Style({
                    geometry: new Point(end),
                    image: new RegularShape({
                        points: 3,
                        radius:  Math.min(3 ,0.8 / resolution),
                        rotation,
                        rotateWithView: true,
                        fill: new Fill({ color }),
                    }),
                }));
            }
        }

        // node 임시 비활성화
        // if (geom instanceof Point && props.featureType === "node") {
        //     styles.push(new Style({
        //         image: new RegularShape({
        //             points: 4,
        //             radius: 4,
        //             angle: Math.PI / 4,
        //             fill: new Fill({ color: "#000000" }),
        //             stroke: new Stroke({ color: "#ffffff", width: 1 }),
        //         }),
        //     }));
        // }

        return styles;
    }

    public async load(): Promise<void> {
        const url = import.meta.env.VITE_API_URL + "/network";
        try {
            const response = await fetch(url);
            const { nodes, links } = await response.json();

            const baseLng = 126.7325;
            const baseLat = 37.4928;
            const toCoord = (x: number, y: number) =>
                fromLonLat([baseLng + x / 88000, baseLat + y / 111000]);

            const featureBuffer: Feature[] = [];
            const laneMap = new Map<string, Feature>();

            for (const node of nodes) {
                node.lng = baseLng + node.xCoord / 88000;
                node.lat = baseLat + node.yCoord / 111000;

                const point = new Point(fromLonLat([node.lng, node.lat]));
                const nodeFeature = new Feature(point);
                nodeFeature.set("properties", { ...node, featureType: "node" });
                featureBuffer.push(nodeFeature);
            }

            for (const link of links) {
                const [firstPt, lastPt] = link.shape.split(" ");
                const [x1, y1] = firstPt.split(",").map(parseFloat);
                const [x2, y2] = lastPt.split(",").map(parseFloat);
                const p1 = toCoord(x1, y1);
                const p2 = toCoord(x2, y2);

                const dx = p2[0] - p1[0];
                const dy = p2[1] - p1[1];
                const len = Math.hypot(dx, dy);
                const unitNormal: [number, number] = len > 0 ? [-dy / len, dx / len] : [0, 0];

                const line = new LineString([p1, p2]);
                featureBuffer.push(new Feature({
                    geometry: line,
                    properties: { ...link, featureType: "link-line" },
                }));

                const half = link.width / 2;
                const left = [p1, p2].map(([x, y]) => [x - unitNormal[0] * half, y - unitNormal[1] * half]);
                const right = [p2, p1].map(([x, y]) => [x + unitNormal[0] * half, y + unitNormal[1] * half]);
                const polygon = new Polygon([[...left, ...right, left[0]]]);
                featureBuffer.push(new Feature({
                    geometry: polygon,
                    properties: { ...link, featureType: "link" },
                }));

                const laneCount = link.lanes?.length ?? 1;
                for (let i = 0; i < laneCount; i++) {
                    const lane = link.lanes[i];
                    const laneWidth = lane.width ?? 3.5;
                    const offset = ((laneCount - 1) / 2 - i) * laneWidth;
                    const centerP1 = [p1[0] + unitNormal[0] * offset, p1[1] + unitNormal[1] * offset];
                    const centerP2 = [p2[0] + unitNormal[0] * offset, p2[1] + unitNormal[1] * offset];

                    const halfWidth = laneWidth / 2;
                    const outerP1 = [centerP1[0] + unitNormal[0] * halfWidth, centerP1[1] + unitNormal[1] * halfWidth];
                    const outerP2 = [centerP2[0] + unitNormal[0] * halfWidth, centerP2[1] + unitNormal[1] * halfWidth];
                    const innerP1 = [centerP1[0] - unitNormal[0] * halfWidth, centerP1[1] - unitNormal[1] * halfWidth];
                    const innerP2 = [centerP2[0] - unitNormal[0] * halfWidth, centerP2[1] - unitNormal[1] * halfWidth];

                    const laneProps = {
                        ...lane,
                        linkId: link.id,
                        laneId: lane.id,
                        fromLink: link.id,
                        featureType: "lane",
                        laneIndex: i,
                        laneSource: centerP1,
                        laneTarget: centerP2,
                    };

                    const laneFeature = new Feature(new Polygon([[innerP1, innerP2, outerP2, outerP1, innerP1]]));
                    laneFeature.set("properties", laneProps);
                    laneMap.set(`${link.id}_${lane.id}`, laneFeature);
                    featureBuffer.push(laneFeature);

                    const laneLineFeature = new Feature(new LineString([centerP1, centerP2]));
                    laneLineFeature.set("properties", { ...laneProps, featureType: "lane-line" });
                    featureBuffer.push(laneLineFeature);
                }
            }

            for (const node of nodes) {
                if (!node.connections) continue;
                for (const conn of node.connections) {
                    const from = laneMap.get(`${conn.fromLink}_${conn.fromLane}`);
                    const to = laneMap.get(`${conn.toLink}_${conn.toLane}`);
                    if (!from || !to) continue;

                    const fromPt = from.get("properties")?.laneTarget;
                    const toPt = to.get("properties")?.laneSource;

                    const dx = toPt[0] - fromPt[0];
                    const dy = toPt[1] - fromPt[1];
                    const len = Math.hypot(dx, dy);
                    const unitNormal: [number, number] = len > 0 ? [-dy / len, dx / len] : [0, 0];
                    const half = conn.width / 2;

                    const connLine = new LineString([fromPt, toPt]);
                    const connLineFeature = new Feature(connLine);
                    connLineFeature.set("properties", {
                        ...conn,
                        featureType: "connection-line",
                        fromNodeType: node.type,
                    });
                    featureBuffer.push(connLineFeature);

                    const outer1 = [fromPt[0] + unitNormal[0] * half, fromPt[1] + unitNormal[1] * half];
                    const outer2 = [toPt[0] + unitNormal[0] * half, toPt[1] + unitNormal[1] * half];
                    const inner2 = [toPt[0] - unitNormal[0] * half, toPt[1] - unitNormal[1] * half];
                    const inner1 = [fromPt[0] - unitNormal[0] * half, fromPt[1] - unitNormal[1] * half];

                    const connPolygon = new Polygon([[outer1, outer2, inner2, inner1, outer1]]);
                    const connFeature = new Feature(connPolygon);
                    connFeature.set("properties", {
                        ...conn,
                        featureType: "connection",
                        arrowStart: fromPt,
                        arrowEnd: toPt,
                    });
                    featureBuffer.push(connFeature);
                }
            }

            this.source.addFeatures(featureBuffer);
            console.log("NetworkLayer: 로드 완료");
        } catch (e) {
            console.error("NetworkLayer.load 에러:", e);
        }
    }
}
