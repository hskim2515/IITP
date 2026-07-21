import React, { useEffect, useRef, useState } from 'react';
import OLMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import VectorTileLayer from 'ol/layer/VectorTile';
import VectorTileSource from 'ol/source/VectorTile';
import MVT from 'ol/format/MVT';
import { createXYZ } from 'ol/tilegrid';
import { Style, Stroke } from 'ol/style';
import { fromLonLat } from 'ol/proj';
import { boundingExtent } from 'ol/extent';
import axiosInstance from '@api/axiosInstance';

interface Props {
    versionId: string;
}

type Status = 'loading' | 'ready' | 'empty' | 'error';

const PREVIEW_STYLE = new Style({ stroke: new Stroke({ color: '#00eaff', width: 1.1 }) });

// MapRangePicker.tsx(시나리오 선택 화면 지도 선택기)와 동일한 키/스타일 — 지역을 가늠할 수 있도록
// 라벨이 있는 어두운 배경지도(midnight)를 깔아 도로망 라인이 그 위에 도드라지게 한다.
const VWORLD_KEY = "7204BDCE-E6CC-38EA-99D1-12423A232259";
const BASEMAP_URL = `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/midnight/{z}/{y}/{x}.png`;

/**
 * 시나리오 선택 화면의 hover 미리보기용 — 인터랙션 없는 초소형 지도.
 * 메인 앱의 NetworkMvtLayer 와 동일한 /network/{versionId}/tiles.mvt(overview 등급)를
 * 재사용하되, 현재 활성 시나리오/버전과 무관하게 hover된 특정 버전만 독립적으로 그린다.
 */
const NetworkMiniPreviewMap: React.FC<Props> = ({ versionId }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<OLMap | null>(null);
    const [status, setStatus] = useState<Status>('loading');

    useEffect(() => {
        let cancelled = false;
        setStatus('loading');

        axiosInstance.get(`/network/${versionId}/extent`)
            .then(res => {
                if (cancelled || !containerRef.current) return;
                const { west, south, east, north } = res.data ?? {};
                if ([west, south, east, north].some((v) => typeof v !== 'number')) {
                    setStatus('empty');
                    return;
                }

                const apiBaseUrl = import.meta.env.VITE_API_URL;
                const tileGrid = createXYZ({ maxZoom: 22 });
                const source = new VectorTileSource({
                    format: new MVT(),
                    tileGrid,
                    tileUrlFunction: (tileCoord) => {
                        const z = tileCoord[0] ?? 0;
                        const x = tileCoord[1] ?? 0;
                        const y = tileCoord[2] ?? 0;
                        return `${apiBaseUrl}/network/${versionId}/tiles.mvt?z=${z}&x=${x}&y=${y}&lod=overview`;
                    },
                });
                const baseLayer = new TileLayer({ source: new XYZ({ url: BASEMAP_URL, maxZoom: 18 }) });
                const networkLayer = new VectorTileLayer({ source, style: PREVIEW_STYLE });

                const map = new OLMap({
                    target: containerRef.current,
                    layers: [baseLayer, networkLayer],
                    view: new View({ center: [0, 0], zoom: 2 }),
                    controls: [],
                    interactions: [],
                });
                const extentMerc = boundingExtent([
                    fromLonLat([west, south]),
                    fromLonLat([east, north]),
                ]);
                map.getView().fit(extentMerc, { padding: [8, 8, 8, 8], maxZoom: 17 });

                mapRef.current = map;
                setStatus('ready');
            })
            .catch((e) => {
                if (cancelled) return;
                setStatus(e?.response?.status === 404 ? 'empty' : 'error');
            });

        return () => {
            cancelled = true;
            mapRef.current?.setTarget(undefined);
            mapRef.current = null;
        };
    }, [versionId]);

    return (
        <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0c0d15', borderRadius: 6, overflow: 'hidden' }}>
            <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
            {status !== 'ready' && (
                <div style={{
                    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, color: '#666', textAlign: 'center', padding: '0 10px', pointerEvents: 'none',
                }}>
                    {status === 'loading' && '불러오는 중...'}
                    {status === 'empty' && '네트워크 데이터 없음'}
                    {status === 'error' && '미리보기를 불러올 수 없습니다'}
                </div>
            )}
        </div>
    );
};

export default NetworkMiniPreviewMap;
