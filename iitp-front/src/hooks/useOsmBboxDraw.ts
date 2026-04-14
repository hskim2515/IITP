import { useEffect, useRef } from 'react';
import DragBox from 'ol/interaction/DragBox';
import { shiftKeyOnly } from 'ol/events/condition';
import { toLonLat } from 'ol/proj';
import { useOpenLayersStore } from '@stores/useOpenLayersStore';
import { useOsmBboxStore } from '@stores/useOsmBboxStore';

/**
 * OSM bbox 선택 모드일 때 OL 지도에 DragBox 인터랙션을 추가.
 * Shift + 드래그 → bbox 그리기 / 일반 드래그 → 지도 이동(기본 동작 유지)
 * 드래그 완료 시 extent → WGS84 bbox로 변환 후 스토어에 저장.
 * Maps.tsx 에서 호출.
 */
export function useOsmBboxDraw() {
    const selecting = useOsmBboxStore((s) => s.selecting);
    const setBbox   = useOsmBboxStore((s) => s.setBbox);
    const setSelecting = useOsmBboxStore((s) => s.setSelecting);

    const dragBoxRef = useRef<DragBox | null>(null);

    useEffect(() => {
        const olMap = useOpenLayersStore.getState().map;
        if (!olMap) return;

        if (selecting) {
            // Shift + 드래그일 때만 bbox 그리기, 일반 드래그는 지도 이동 유지
            const dragBox = new DragBox({ condition: shiftKeyOnly });
            dragBoxRef.current = dragBox;
            olMap.addInteraction(dragBox);

            dragBox.on('boxend', () => {
                const extent = dragBox.getGeometry().getExtent(); // [minX, minY, maxX, maxY]
                const sw = toLonLat([extent[0] ?? 0, extent[1] ?? 0]);
                const ne = toLonLat([extent[2] ?? 0, extent[3] ?? 0]);
                setBbox({
                    south: Math.min(sw[1] ?? 0, ne[1] ?? 0),
                    west:  Math.min(sw[0] ?? 0, ne[0] ?? 0),
                    north: Math.max(sw[1] ?? 0, ne[1] ?? 0),
                    east:  Math.max(sw[0] ?? 0, ne[0] ?? 0),
                });
            });

            return () => {
                olMap.removeInteraction(dragBox);
                dragBoxRef.current = null;
            };
        }
    }, [selecting, setBbox, setSelecting]);
}
