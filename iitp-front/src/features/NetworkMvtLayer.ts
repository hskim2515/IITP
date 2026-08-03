import VectorTileLayer from "ol/layer/VectorTile";
import VectorTileSource from "ol/source/VectorTile";
import MVT from "ol/format/MVT";
import { Fill, Stroke, Style } from "ol/style";
import Polygon from "ol/geom/Polygon";
import type { FeatureLike } from "ol/Feature";
import { createXYZ } from "ol/tilegrid";
import { NETWORK_TILING, getNetworkLodTierByResolution } from "@utils/lodConstants";
import { useNetworkEditStore } from "@stores/useNetworkEditStore";
import { getActiveVersionId } from "@utils/versionId";
import { isNetworkFeatureTypeVisible } from "@utils/networkPrimitiveShared";

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
    // near 도로 폭 폴리곤: 3D COLOR_LINK_BASE(72,74,80) 불투명 + 어두운 외곽(30,30,35)으로 입체감.
    private static readonly STYLE_ROAD = new Style({
        fill: new Fill({ color: "rgb(72,74,80)" }),
        stroke: new Stroke({ color: "rgba(30,30,35,0.85)", width: 1.0 }),
    });
    // detail 차선 폴리곤: 3D LANE_COLORS 짝/홀 음영 번갈아 (62,64,70)/(84,86,94) + 얇은 어두운 경계.
    private static readonly STYLE_LANE_A = new Style({
        fill: new Fill({ color: "rgb(62,64,70)" }),
        stroke: new Stroke({ color: "rgba(30,30,35,0.6)", width: 0.4 }),
    });
    private static readonly STYLE_LANE_B = new Style({
        fill: new Fill({ color: "rgb(84,86,94)" }),
        stroke: new Stroke({ color: "rgba(30,30,35,0.6)", width: 0.4 }),
    });
    /** 진행방향 화살표 배치 간격(m, OL 투영 단위 ≈ m) — 3D(NetworkDataSourceLayer)와 동일 값 */
    private static readonly ARROW_INTERVAL_M = 25;

    /** 캐시 무효화 세대 홀더 — refreshTiles() 시 증가해 타일 URL 을 바꿔 OL/브라우저 캐시를 모두 우회
     *  (tileUrlFunction 이 super() 전에 정의되므로 this 대신 홀더 객체로 참조) */
    private readonly revBox: { rev: number };

    constructor(versionId: string, apiBaseUrl: string) {
        const tileGrid = createXYZ({ maxZoom: 22 });
        const revBox = { rev: 0 };
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
                // versionId 는 생성 시점 고정이 아니라 매 요청 시 동적 조회 —
                // 시나리오/버전 전환 시 이전 버전 타일(이전 네트워크)이 계속 보이는 것 방지
                const vid = getActiveVersionId() ?? versionId;
                return `${apiBaseUrl}/network/${vid}/tiles.mvt?z=${z}&x=${x}&y=${y}&lod=${lod}&rev=${revBox.rev}`;
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
        this.revBox = revBox;
    }

    /**
     * 네트워크 교체(임포트) 후 호출 — OL 내부 타일 캐시와 브라우저 HTTP 캐시를 모두 무효화.
     * rev 증가로 타일 URL 이 바뀌므로 이미 로드된 stale 타일이 새 데이터로 재요청된다.
     */
    public refreshTiles(): void {
        this.revBox.rev++;
        try { this.getSource()?.refresh(); } catch (_) {}
        this.changed();
    }

    /**
     * 도로/차선 폴리곤 ring(flat 좌표)에서 근사 중심선을 복원한다.
     * 백엔드 NetworkTileService.buildOffsetPolygon()의 ring = "left 정순 + right 역순"
     * 규약(닫힌 폴리곤) 그대로: ring[i]와 ring[n-1-i]는 원래 중심선의 같은 점을 좌우
     * 대칭 offset한 것이므로, 그 중점이 원래 중심선 점이다(도로 폴리곤은 정확히 복원,
     * 차선 폴리곤은 그 차선 자체의 — 도로와 거의 평행한 — 중심선으로 복원됨. 방향
     * 계산엔 어느 쪽이든 충분). near/detail은 항상 폴리곤만 오고 LineString은 거의
     * 안 와서(NetworkTileService 참고) 화살표를 폴리곤에서 직접 뽑아야 한다.
     */
    private static reconstructCenterlineFromRing(flat: number[]): number[] {
        let n = Math.floor(flat.length / 2);
        if (n < 4) return [];
        // 폐합 중복점(첫 점=끝 점) 제거 후 계산
        if (Math.abs(flat[0]! - flat[(n - 1) * 2]!) < 1e-6 && Math.abs(flat[1]! - flat[(n - 1) * 2 + 1]!) < 1e-6) {
            n -= 1;
        }
        const m = Math.floor(n / 2);
        if (m < 2) return [];
        const center: number[] = [];
        for (let i = 0; i < m; i++) {
            const ax = flat[i * 2]!, ay = flat[i * 2 + 1]!;
            const bx = flat[(n - 1 - i) * 2]!, by = flat[(n - 1 - i) * 2 + 1]!;
            center.push((ax + bx) / 2, (ay + by) / 2);
        }
        return center;
    }

    /** MVT RenderFeature의 flat 좌표(x0,y0,x1,y1,...)를 따라 ARROW_INTERVAL_M 간격으로 진행방향
     *  화살표 삼각형 Style을 생성한다 — NetworkFeatureLayer.buildDirectionArrowStyles /
     *  NetworkDataSourceLayer.buildArrowInstances(3D)와 동일 사고방식·간격. RenderFeature는
     *  getGeometry()가 없어 flat 좌표를 직접 순회해야 한다. */
    private static buildDirectionArrowStyles(flat: number[]): Style[] {
        const n = Math.floor(flat.length / 2);
        if (n < 2) return [];
        const segLens: number[] = [];
        let total = 0;
        for (let i = 1; i < n; i++) {
            const d = Math.hypot(flat[i * 2]! - flat[(i - 1) * 2]!, flat[i * 2 + 1]! - flat[(i - 1) * 2 + 1]!);
            segLens.push(d);
            total += d;
        }
        if (total < 1) return [];

        const interval = NetworkMvtLayer.ARROW_INTERVAL_M;
        const arrowLen = 3;
        const halfWidth = 0.9;
        const marks: number[] = total < interval
            ? [total / 2]
            : (() => {
                const out: number[] = [];
                for (let d = interval / 2; d < total; d += interval) out.push(d);
                return out;
            })();

        const styles: Style[] = [];
        for (const mark of marks) {
            let acc = 0;
            let segIdx = 0;
            while (segIdx < segLens.length - 1 && acc + segLens[segIdx]! < mark) {
                acc += segLens[segIdx]!;
                segIdx++;
            }
            const segLen = segLens[segIdx] ?? 0;
            if (segLen < 1e-6) continue;
            const p0x = flat[segIdx * 2]!, p0y = flat[segIdx * 2 + 1]!;
            const p1x = flat[(segIdx + 1) * 2]!, p1y = flat[(segIdx + 1) * 2 + 1]!;
            const frac = Math.min(1, Math.max(0, (mark - acc) / segLen));
            const cx = p0x + (p1x - p0x) * frac;
            const cy = p0y + (p1y - p0y) * frac;

            const dx = p1x - p0x, dy = p1y - p0y;
            const dlen = Math.hypot(dx, dy);
            if (dlen < 1e-6) continue;
            const ux = dx / dlen, uy = dy / dlen;
            const nx = -uy, ny = ux;

            const tip: [number, number]      = [cx + ux * arrowLen / 2, cy + uy * arrowLen / 2];
            const backCx = cx - ux * arrowLen / 2, backCy = cy - uy * arrowLen / 2;
            const backLeft: [number, number]  = [backCx + nx * halfWidth, backCy + ny * halfWidth];
            const backRight: [number, number] = [backCx - nx * halfWidth, backCy - ny * halfWidth];

            styles.push(new Style({
                geometry: new Polygon([[tip, backLeft, backRight, tip]]),
                fill: new Fill({ color: "rgba(255,255,255,0.75)" }),
            }));
        }
        return styles;
    }

    private styleFunction(feature: FeatureLike, resolution: number): Style | Style[] | undefined {
        // USE_MVT_2D(정식)면 전 줌 표시. 아니면 near/detail(확대)에서 렌더 생략(기존 벡터에 양보)
        if (!NETWORK_TILING.USE_MVT_2D && resolution < NETWORK_TILING.MVT_MAX_RESOLUTION) return undefined;
        // 폴리곤은 면 채움(near=도로, detail=차선 음영), 중심선은 stroke. 캐시된 스타일 재사용.
        // MVT RenderFeature 는 getType()/getId() 가 있으나 FeatureLike 타입엔 없어 any 캐스팅.
        const f = feature as any;
        const tier = getNetworkLodTierByResolution(resolution);
        // 레이어 패널 가시화 off — MVT 는 per-feature setStyle 이 불가하므로 style 단계에서 제외해야
        // 실제로 화면에서 사라진다 (레이어 패널에서 껐는데 2D 에 계속 보이던 원인).
        // 게이트는 NetworkFeatureLayer.styleFunction / 2D·3D 픽 경로와 같은 공유 helper 로 일원화.
        const isLanePolygon = f.getType?.() === "Polygon" && tier === "detail";
        if (!isNetworkFeatureTypeVisible(isLanePolygon ? "lanes" : "links")) return undefined;
        // 편집 마스킹: 삭제/수정된 링크(저장 전)는 서버 MVT 에 옛 형상으로 남아있으므로 숨김.
        //   삭제 → 완전 숨김. 수정 → 델타 오버레이가 새 형상을 그리므로 원본을 숨겨 이중 렌더 방지.
        //   feature id: 중심선/도로=linkId, 차선폴리곤=linkId*100+laneIdx → /100 으로 링크 id 복원.
        const editState = useNetworkEditStore.getState();
        const deleted = editState.deletedLinkIds;
        const edited = editState.editedLinkIds;
        if (deleted.size > 0 || edited.size > 0) {
            const rawId = Number(f.getId?.() ?? -1);
            const linkId = (f.getType?.() === "Polygon" && tier === "detail") ? Math.floor(rawId / 100) : rawId;
            const key = String(linkId);
            if (deleted.has(key) || edited.has(key)) return undefined; // 삭제/수정 링크 → 렌더 생략
        }
        if (f.getType?.() === "Polygon") {
            // near/detail은 항상 폴리곤만 오고 중심선 LineString은 거의 안 온다(아래 참고) —
            // 진행방향 화살표는 폴리곤 ring에서 중심선을 복원해 붙인다.
            const flat = f.getFlatCoordinates?.() as number[] | undefined;
            const arrows = flat
                ? NetworkMvtLayer.buildDirectionArrowStyles(NetworkMvtLayer.reconstructCenterlineFromRing(flat))
                : [];
            if (tier === "detail") {
                // 차선 id = link*100 + laneIdx → laneIdx 짝/홀로 음영 번갈아 (3D LANE_COLORS 일치)
                const li = Number(f.getId?.() ?? 0) % 100;
                const base = li % 2 === 0 ? NetworkMvtLayer.STYLE_LANE_A : NetworkMvtLayer.STYLE_LANE_B;
                return arrows.length > 0 ? [base, ...arrows] : base;
            }
            return arrows.length > 0 ? [NetworkMvtLayer.STYLE_ROAD, ...arrows] : NetworkMvtLayer.STYLE_ROAD; // near 도로 폭 폴리곤
        }
        if (tier === "overview") return NetworkMvtLayer.STYLE_OVERVIEW;
        if (tier === "mid") return NetworkMvtLayer.STYLE_LINE;
        // near/detail: 도로/차선 폴리곤이 이미 그려지는 구간 — 위에 진행방향 화살표를 얹는다.
        // (overview/mid은 화면에 링크가 너무 많아 화살표가 시각적으로 지저분해지므로 제외)
        const flat = f.getFlatCoordinates?.() as number[] | undefined;
        if (!flat || flat.length < 4) return NetworkMvtLayer.STYLE_LINE;
        return [NetworkMvtLayer.STYLE_LINE, ...NetworkMvtLayer.buildDirectionArrowStyles(flat)];
    }
}
