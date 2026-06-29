import VectorTileLayer from "ol/layer/VectorTile";
import VectorTileSource from "ol/source/VectorTile";
import MVT from "ol/format/MVT";
import { Fill, Stroke, Style } from "ol/style";
import type { FeatureLike } from "ol/Feature";
import { createXYZ } from "ol/tilegrid";
import { NETWORK_TILING, getNetworkLodTierByResolution } from "@utils/lodConstants";

/**
 * 네트워크 MVT(PBF) 레이어 (단계 3) — overview/mid 2D 도로망을 OL VectorTile 로 렌더.
 *
 * <p>서버 `GET /network/{versionId}/tiles.mvt?z&x&y&lod` 의 PBF 를 OL 네이티브 VectorTile
 * (워커 디코딩 + 타일 캐시/evict 내장)로 처리한다. 링크 중심선만 가벼운 stroke 로 그려
 * 전국 조망에서 도로망을 항상 보이게 한다.
 *
 * <p>near/detail 로 확대하면(MVT_MAX_RESOLUTION 미만) 숨겨지고, 기존 NetworkFeatureLayer
 * (또는 타일 모드)가 풍부한 geometry(폴리곤·차선)를 담당한다.
 */
export default class NetworkMvtLayer extends VectorTileLayer {
    // 스타일 캐시 (feature·렌더마다 new Style 생성하던 안티패턴 제거 → 줌/팬 버벅임 완화)
    private static readonly STYLE_OVERVIEW = new Style({ stroke: new Stroke({ color: "rgba(236,238,245,0.9)", width: 1.2 }) });
    private static readonly STYLE_LINE     = new Style({ stroke: new Stroke({ color: "rgba(236,238,245,0.9)", width: 1.6 }) });
    // near 도로 폭 폴리곤: 면 채움 + 외곽선 (실제 도로 모양)
    private static readonly STYLE_POLYGON  = new Style({
        fill: new Fill({ color: "rgba(120,124,140,0.55)" }),
        stroke: new Stroke({ color: "rgba(236,238,245,0.85)", width: 0.8 }),
    });

    constructor(versionId: string, apiBaseUrl: string) {
        const tileGrid = createXYZ({ maxZoom: 22 });
        const source = new VectorTileSource({
            format: new MVT(),
            tileGrid,
            // lod 를 z(zoom) 가 아니라 resolution 기반 tier 로 결정 → 3D(pixelSize→tier)와 동일 기준.
            // (이전엔 z>=15 near 처럼 zoom 임계라 같은 화면에서 3D(res 임계)와 tier 가 어긋났음)
            tileUrlFunction: (tileCoord) => {
                const z = tileCoord[0] ?? 0;
                const x = tileCoord[1] ?? 0;
                const y = tileCoord[2] ?? 0;
                const res = tileGrid.getResolution(z);
                const lod = getNetworkLodTierByResolution(res); // overview/mid/near (3D와 동일 함수)
                return `${apiBaseUrl}/network/${versionId}/tiles.mvt?z=${z}&x=${x}&y=${y}&lod=${lod}`;
            },
            // 빈 타일(204)도 정상 처리되도록 — OL 은 빈 응답을 빈 타일로 취급
        });

        super({
            source,
            visible: false,
            zIndex: 295, // NetworkFeatureLayer(300) 바로 아래
            // overview/mid 구간에서만 표시 (확대하면 벡터 레이어가 담당)
            minZoom: 0,
            renderMode: "hybrid",
            style: (feature, resolution) => this.styleFunction(feature, resolution),
        });
    }

    private styleFunction(feature: FeatureLike, resolution: number): Style | undefined {
        // [PoC] POC_MVT_ALL_ZOOM 이면 전 줌 표시. 아니면 near/detail(확대)에서 렌더 생략(기존 벡터에 양보)
        if (!NETWORK_TILING.POC_MVT_ALL_ZOOM && resolution < NETWORK_TILING.MVT_MAX_RESOLUTION) return undefined;
        // near 도로 폭 폴리곤은 면 채움, overview/mid 중심선은 stroke. 캐시된 스타일 재사용.
        // MVT RenderFeature 는 getType()이 있으나 FeatureLike 타입엔 없어 any 캐스팅.
        const geomType = (feature as any).getType?.();
        if (geomType === "Polygon") return NetworkMvtLayer.STYLE_POLYGON;
        const tier = getNetworkLodTierByResolution(resolution);
        return tier === "overview" ? NetworkMvtLayer.STYLE_OVERVIEW : NetworkMvtLayer.STYLE_LINE;
    }
}
