import { useEffect } from 'react';
import { Draw } from 'ol/interaction';
import { Polygon } from 'ol/geom';
import { Vector as VectorSource } from 'ol/source';
import { Vector as VectorLayer } from 'ol/layer';
import { toLonLat } from 'ol/proj';
import { useOpenLayersStore } from '@stores/useOpenLayersStore';
import { useNetworkDrawStore } from '@stores/useNetworkDrawStore';
import { useNetworkStore } from '@stores/useNetworkStore';
import { useMessageStore } from '@stores/useMessageStore';
import { setSimTypeForLinks, applyNetworkUpdate } from '@hooks/useNetworkSelect';

/** SimType.java Micro(1) 과 반드시 일치 */
const SIM_TYPE_MICRO = 1;

/**
 * 마이크로 시뮬레이션 영역 그리기 — useKtdbPolygonDraw.ts와 병렬 구조(OL 자유 다각형 Draw,
 * 더블클릭으로 완성). 완성된 폴리곤에 시작/끝점이 걸치는 링크를 찾아 simType=Micro로 일괄
 * 지정한다 — 레거시 참조 구현(source_code/frontend/App.js의 isMicro 계산: 도로 시작/끝점이
 * 그려진 경계 폴리곤 안에 있으면 마이크로)과 동일한 규칙. Maps.tsx에서 호출.
 *
 * ⚠️ 여기서 지정한 simType은 currentJsonData만 바꾼다(applyNetworkUpdate — 다른 네트워크
 * 편집과 동일하게 "저장"을 눌러야 network.xml에 반영되고, 그래야 NextSimRunner의 mode.xml
 * 생성이 이 값을 읽는다). 또한 Micro가 이 NextSim 바이너리에서 크래시 없이 도는지 검증된 적
 * 없다는 걸 사용자에게 매번 상기시킨다(NextSimRunner.java 주석 참고).
 */
export function useMicroRegionDraw() {
    const active = useNetworkDrawStore((s) => s.microRegionDrawActive);

    useEffect(() => {
        const olMap = useOpenLayersStore.getState().map;
        if (!olMap || !active) return;

        const source = new VectorSource();
        const layer = new VectorLayer({ source });
        olMap.addLayer(layer);

        const draw = new Draw({ source, type: 'Polygon' });
        olMap.addInteraction(draw);

        draw.on('drawend', (event: any) => {
            const polygon = event.feature.getGeometry() as Polygon;
            const ring = polygon.getCoordinates()[0] ?? [];
            const lonLatRing = ring.map((c: number[]) => toLonLat(c));
            applyMicroRegion(lonLatRing);
            useNetworkDrawStore.getState().setMicroRegionDrawActive(false);
        });

        return () => {
            olMap.removeInteraction(draw);
            olMap.removeLayer(layer);
            source.clear();
        };
    }, [active]);
}

function applyMicroRegion(lonLatRing: number[][]): void {
    const network = useNetworkStore.getState().currentJsonData;
    if (!network?.links?.length) return;

    const boundary = new Polygon([lonLatRing]);
    const matchedIds: string[] = [];
    for (const link of network.links) {
        const coords = link.coordinates;
        if (!coords || coords.length === 0) continue;
        const start = coords[0];
        const end = coords[coords.length - 1];
        const startInside = start != null && boundary.intersectsCoordinate([start.lng, start.lat]);
        const endInside = end != null && boundary.intersectsCoordinate([end.lng, end.lat]);
        if (startInside || endInside) matchedIds.push(String(link.id));
    }

    if (matchedIds.length === 0) {
        useMessageStore.getState().setMessage({ type: 'info', text: '그린 영역 안에 도로가 없습니다.' });
        return;
    }

    const next = setSimTypeForLinks(network, matchedIds, SIM_TYPE_MICRO);
    applyNetworkUpdate(next);
    useMessageStore.getState().setMessage({
        type: 'info',
        text: `링크 ${matchedIds.length}개가 마이크로로 지정되었습니다 — 저장해야 실행에 반영됩니다. `
            + `⚠ 마이크로 시뮬레이션은 이 NextSim 배포판에서 크래시 없이 도는지 검증된 적이 없습니다.`,
    });
}
