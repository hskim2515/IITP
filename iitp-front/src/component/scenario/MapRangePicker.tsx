import React, { useEffect, useRef, useState } from "react";
import OLMap from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import XYZ from "ol/source/XYZ";
import DragBox from "ol/interaction/DragBox";
import { fromLonLat, toLonLat } from "ol/proj";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import { Polygon } from "ol/geom";
import { Style, Fill, Stroke } from "ol/style";
import "ol/ol.css";

interface Props {
    onSelect: (lon: number, lat: number, bbox: { west: number; south: number; east: number; north: number }) => void;
    onClose: () => void;
}

const VWORLD_KEY = "7204BDCE-E6CC-38EA-99D1-12423A232259";
const TILE_URL = `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/Base/{z}/{y}/{x}.png`;

export default function MapRangePicker({ onSelect, onClose }: Props) {
    const mapRef     = useRef<HTMLDivElement>(null);
    const olMapRef   = useRef<OLMap | null>(null);
    const dragBoxRef = useRef<DragBox | null>(null);
    const boxSource  = useRef(new VectorSource());

    const [drawMode, setDrawMode]   = useState(false);
    const [selected, setSelected]   = useState<{ lon: number; lat: number } | null>(null);

    /* ── OL 지도 초기화 ── */
    useEffect(() => {
        if (!mapRef.current) return;

        const boxLayer = new VectorLayer({
            source: boxSource.current,
            style: new Style({
                fill:   new Fill({ color: "rgba(0, 234, 255, 0.15)" }),
                stroke: new Stroke({ color: "#00eaff", width: 2 }),
            }),
            zIndex: 10,
        });

        const map = new OLMap({
            target: mapRef.current,
            layers: [
                new TileLayer({ source: new XYZ({ url: TILE_URL }) }),
                boxLayer,
            ],
            view: new View({
                center: fromLonLat([127.1, 37.4]),
                zoom: 12,
            }),
        });
        olMapRef.current = map;

        return () => {
            map.setTarget(undefined);
            olMapRef.current = null;
        };
    }, []);

    /* ── 드로우 모드 토글 ── */
    useEffect(() => {
        const map = olMapRef.current;
        if (!map) return;

        if (drawMode) {
            const dragBox = new DragBox({ condition: () => true });
            dragBoxRef.current = dragBox;
            map.addInteraction(dragBox);

            dragBox.on("boxend", () => {
                const extent = dragBox.getGeometry().getExtent();
                const sw = toLonLat([extent[0]!, extent[1]!]);
                const ne = toLonLat([extent[2]!, extent[3]!]);

                const west  = Math.min(sw[0]!, ne[0]!);
                const east  = Math.max(sw[0]!, ne[0]!);
                const south = Math.min(sw[1]!, ne[1]!);
                const north = Math.max(sw[1]!, ne[1]!);
                const lon   = Math.round(((west + east)  / 2) * 1e6) / 1e6;
                const lat   = Math.round(((south + north) / 2) * 1e6) / 1e6;

                boxSource.current.clear();
                boxSource.current.addFeature(
                    new Feature(new Polygon([dragBox.getGeometry().getCoordinates()[0]!])),
                );

                setSelected({ lon, lat });
                setDrawMode(false);
            });

            return () => {
                map.removeInteraction(dragBox);
                dragBoxRef.current = null;
            };
        }
    }, [drawMode]);

    const handleConfirm = () => {
        if (!selected) return;
        onSelect(selected.lon, selected.lat, { west: 0, south: 0, east: 0, north: 0 });
    };

    return (
        <div className="map-picker-overlay">
            {/* 상단 배너 */}
            <div className="map-picker-banner">
                <span className="map-picker-guide">
                    {drawMode
                        ? "드래그하여 시뮬레이션 범위를 선택하세요"
                        : selected
                            ? `📍 중심점: ${selected.lat.toFixed(5)}°N, ${selected.lon.toFixed(5)}°E`
                            : "지도를 이동한 뒤 '범위 선택'을 눌러 드래그하세요"}
                </span>
                <div className="map-picker-actions">
                    {/* 범위 선택 토글 */}
                    <button
                        className={`map-picker-btn${drawMode ? " map-picker-btn--active" : ""}`}
                        onClick={() => {
                            boxSource.current.clear();
                            setSelected(null);
                            setDrawMode((v) => !v);
                        }}
                    >
                        {drawMode ? "✕ 취소" : "✏ 범위 선택"}
                    </button>

                    {/* 선택 완료 (범위 선택 후에만 활성화) */}
                    {selected && !drawMode && (
                        <button className="map-picker-btn map-picker-btn--confirm" onClick={handleConfirm}>
                            ✓ 적용
                        </button>
                    )}

                    <button className="map-picker-btn map-picker-btn--close" onClick={onClose}>
                        닫기
                    </button>
                </div>
            </div>

            {/* 지도 */}
            <div
                ref={mapRef}
                className="map-picker-map"
                style={{ cursor: drawMode ? "crosshair" : "grab" }}
            />
        </div>
    );
}
