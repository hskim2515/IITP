import { Map as OLMap } from "ol";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import { Feature } from "ol";
import { Polygon } from "ol/geom";
import { Fill, Stroke, Style, Text } from "ol/style";
import { fromLonLat } from "ol/proj";
import { FeatureLike } from "ol/Feature";
import { AdminRegionTier, getAdminRegionTier } from "@utils/lodConstants";
import { vcToContinuousColorHex } from "@utils/losScale";

/**
 * `RegionTrafficLayer`(Cesium 3D)의 2D 대응 — 데이터는 Cesium 레이어의 onData 콜백으로 공유받고
 * (중복 fetch 방지), OL 자체 view resolution으로 tier를 독립 판정한다(두 지도가 분할 모드에서
 * 서로 다른 영역/줌을 볼 수 있어 Cesium의 tier 판단을 그대로 강제할 수 없음). 3D 컬럼 대신
 * choropleth 채움 + 숫자 라벨로 단순화.
 */
export default class RegionTrafficOlLayer extends VectorLayer {
    public readonly source: VectorSource;
    private readonly cache = new Map<AdminRegionTier, Feature[]>();
    private activeTier: AdminRegionTier | null = null;
    private olMap: OLMap | null = null;
    private resizeUnsub: (() => void) | null = null;

    constructor() {
        const source = new VectorSource();
        super({
            source,
            visible: false,
            zIndex: 205,
            style: (feature, resolution) => this.styleFunction(feature, resolution),
        });
        this.source = source;
    }

    /** VectorLayerManager가 olMap에 추가한 뒤 호출 — 자체 resolution 변화 감지용 */
    public attachMap(map: OLMap): void {
        this.olMap = map;
        const onChange = () => this.applyTierForCurrentView();
        map.getView().on('change:resolution', onChange);
        this.resizeUnsub = () => map.getView().un('change:resolution', onChange);
        this.applyTierForCurrentView();
    }

    private applyTierForCurrentView(): void {
        const resolution = this.olMap?.getView().getResolution();
        if (resolution == null) return;
        const tier = getAdminRegionTier(resolution);
        this.setActiveTier(tier);
    }

    public styleFunction(feature: FeatureLike, _resolution: number): Style {
        const color = feature.get('color') as string;
        const name = feature.get('name') as string;
        const volume = feature.get('volume') as number;
        return new Style({
            fill: new Fill({ color: color + '59' }), // ≈0.35 alpha
            stroke: new Stroke({ color, width: 1.5 }),
            text: new Text({
                text: `${name}\n${volume?.toLocaleString?.() ?? volume}대`,
                font: '12px sans-serif',
                fill: new Fill({ color: '#ffffff' }),
                stroke: new Stroke({ color: '#000000', width: 3 }),
            }),
        });
    }

    /** RegionTrafficLayer의 onData 콜백에서 호출 — tier별로 캐시만 하고, 활성 tier일 때만 반영 */
    public setData(tier: AdminRegionTier, regions: any[]): void {
        const features: Feature[] = [];
        for (const r of regions) {
            const rings = r.rings ?? [];
            if (rings.length === 0) continue;
            const color = vcToContinuousColorHex(r.vcRatio ?? -1);
            for (const ring of rings) {
                const coords = ring
                    .filter((pt: number[]) => pt && isFinite(pt[0]!) && isFinite(pt[1]!))
                    .map((pt: number[]) => fromLonLat([pt[0]!, pt[1]!]));
                if (coords.length < 3) continue;
                const f = new Feature(new Polygon([coords]));
                f.setProperties({ code: r.code, name: r.name, volume: r.volume, vcRatio: r.vcRatio, color, featureType: 'region' });
                features.push(f);
            }
        }
        this.cache.set(tier, features);
        if (tier === this.activeTier) this.refreshSource();
    }

    public setActiveTier(tier: AdminRegionTier): void {
        if (tier === this.activeTier) return;
        this.activeTier = tier;
        this.refreshSource();
    }

    private refreshSource(): void {
        const features = this.cache.get(this.activeTier as AdminRegionTier) ?? [];
        this.source.clear();
        this.source.addFeatures(features);
    }

    public dispose(): void {
        this.resizeUnsub?.();
        this.source.clear();
        this.cache.clear();
        super.dispose();
    }
}
