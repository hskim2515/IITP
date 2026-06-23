import VectorTileLayer from "ol/layer/VectorTile";
import VectorTileSource from "ol/source/VectorTile";
import MVT from "ol/format/MVT";
import { Stroke, Style } from "ol/style";
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
    constructor(versionId: string, apiBaseUrl: string) {
        const source = new VectorTileSource({
            format: new MVT(),
            tileGrid: createXYZ({ maxZoom: 22 }),
            // 줌 레벨별 가변 lod: 줌인할수록 더 많은 도로 등급 포함
            //   z<12  → overview (간선만)   |   z>=12 → mid (간선+집산)
            // (near/detail 전체 도로는 확대 시 JSON 타일 매니저가 담당)
            tileUrlFunction: (tileCoord) => {
                const z = tileCoord[0] ?? 0;
                const x = tileCoord[1] ?? 0;
                const y = tileCoord[2] ?? 0;
                const lod = z >= 12 ? "mid" : "overview";
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

    private styleFunction(_feature: FeatureLike, resolution: number): Style | undefined {
        // near/detail(확대)에서는 렌더 생략 → 기존 벡터/타일 레이어에 양보
        if (resolution < NETWORK_TILING.MVT_MAX_RESOLUTION) return undefined;
        const tier = getNetworkLodTierByResolution(resolution);
        // 간선일수록(차선 多) 굵게 — 도로망 지도 느낌. 차선수는 MVT 속성 미포함이라 고정폭.
        const width = tier === "overview" ? 1.2 : 1.6;
        return new Style({
            stroke: new Stroke({ color: "rgba(236,238,245,0.9)", width }),
        });
    }
}
