import { useEffect, useRef } from 'react';
import { Draw } from 'ol/interaction';
import { Polygon } from 'ol/geom';
import { Vector as VectorSource } from 'ol/source';
import { Vector as VectorLayer } from 'ol/layer';
import { toLonLat } from 'ol/proj';
import { useOpenLayersStore } from '@stores/useOpenLayersStore';
import { useOsmBboxStore } from '@stores/useOsmBboxStore';

/**
 * KTDB 임포트 전용 폴리곤 경계 그리기 — useOsmBboxDraw(OSM 사각형 DragBox)와 병렬 구조.
 * selectingPolygon 이 true일 때 OL 지도에 자유 다각형 Draw 인터랙션을 추가하고,
 * 더블클릭으로 완성하면 WGS84 좌표로 변환해 스토어에 저장한다. Maps.tsx 에서 호출.
 */
export function useKtdbPolygonDraw() {
    const selectingPolygon = useOsmBboxStore((s) => s.selectingPolygon);
    const setPolygons = useOsmBboxStore((s) => s.setPolygons);

    const drawRef = useRef<Draw | null>(null);
    const sourceRef = useRef<VectorSource | null>(null);
    const layerRef = useRef<VectorLayer | null>(null);

    useEffect(() => {
        const olMap = useOpenLayersStore.getState().map;
        if (!olMap) return;

        if (selectingPolygon) {
            const source = new VectorSource();
            const layer = new VectorLayer({ source });
            sourceRef.current = source;
            layerRef.current = layer;
            olMap.addLayer(layer);

            const draw = new Draw({ source, type: 'Polygon' });
            drawRef.current = draw;
            olMap.addInteraction(draw);

            draw.on('drawend', (event: any) => {
                const polygon = event.feature.getGeometry() as Polygon;
                const ring = polygon.getCoordinates()[0] ?? [];
                const lonLatRing = ring.map((c: number[]) => toLonLat(c));
                setPolygons([lonLatRing]);
            });

            return () => {
                olMap.removeInteraction(draw);
                olMap.removeLayer(layer);
                source.clear();
                drawRef.current = null;
                sourceRef.current = null;
                layerRef.current = null;
            };
        }
    }, [selectingPolygon, setPolygons]);
}
