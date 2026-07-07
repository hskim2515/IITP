import React, { useCallback, useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import MapCesium from "@component/map/MapCesium";
import MapOL from "@component/map/MapOL";
import useMapInit from "@hooks/useMapInit";
import useSimulation from "@hooks/useSimulation";
import useMapSync from "@hooks/sync/useMapSync";
import { useNaverBaseMap } from "@hooks/useNaverBaseMap";
import useLayer from "@hooks/useLayer";
import { useLayerSchemaStore } from "@stores/useLayerSchemaStore";
import { useLayerStore } from "@stores/useLayerStore";
import { useMapStore } from "@stores/useMapStore";
import useLayerInit from "@hooks/useLayerInit";
import useDefaultSelect from "@hooks/sync/select/useDefaultSelect";
import '../../App.css'
import useDefaultMoveMouse from "@hooks/sync/move/useDefaultMoveMouse";
import styles from "@css/Maps.module.css"
import Divider from "@component/map/Divider";
import ToolsPanel from "@component/tool/ToolsPanel";
import { useNetworkDraw } from "@hooks/useNetworkDraw";
import { useNetworkSelect } from "@hooks/useNetworkSelect";
import { useOsmBboxDraw } from "@hooks/useOsmBboxDraw";
import useNetworkStationModify from "@hooks/useNetworkStationModify";
import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";
import NodeContextMenu from "@component/tool/NodeContextMenu";
import { useCoordPick } from "@hooks/useCoordPick";
import { useOsmBboxStore } from "@stores/useOsmBboxStore";
import { useNetworkTileStore } from "@stores/useNetworkTileStore";
import { useBackgroundTaskStore } from "@stores/useBackgroundTaskStore";
import { useVehicleStore } from "@stores/useVehicleStore";

// 3D 전용 테스트 모드 — true로 설정 시 OpenLayers 비활성화, Cesium만 실행
const ONLY_3D = false;

interface MapsProps {
    singleMapMode?: boolean;
}

const Maps = ({ singleMapMode = false }: MapsProps) => {
    const mapViewMode = useMapStore((s) => s.mapViewMode);
    const setMapViewMode = useMapStore((s) => s.setMapViewMode);

    useEffect(() => {
        if (ONLY_3D) setMapViewMode('3D');
    }, []);

    const isNetworkEditActive = useNetworkDrawStore(
        (s) => s.isActive || s.isSelectActive || s.placementMode !== 'none'
    );
    const coordPickActive = useMapStore((s) => s.coordPickCallback !== null);
    const selecting = useOsmBboxStore((s) => s.selecting);
    const prevModeRef = useRef<typeof mapViewMode | null>(null);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const openlayersMapRef = useRef<HTMLDivElement | undefined>(undefined);
    const cesiumMapRef = useRef<Element | null>(null);
    // 네이버 배경 지도 (읽기 전용, OL 아래 겹침). 배경지도로 '네이버' 선택 + 키 설정 시 활성.
    const naverMapRef = useRef<HTMLDivElement | null>(null);
    const currentBaseMap = useMapStore((s) => s.currentBaseMap);
    const naverEnabled = !!process.env.REACT_APP_NAVER_MAP_CLIENT_ID && currentBaseMap === 'naver';
    const isResizing = useRef(false);

    const [dividerX, setDividerX] = useState<number | null>(null);

    const {fetchLayerSchema, loading: schemaLoading} = useLayerSchemaStore();
    const isInitialized = useLayerStore((s) => s.isInitialized);
    const tileLoading = useNetworkTileStore((s) => s.loadingCount > 0);
    const bgTasks = useBackgroundTaskStore((s) => s.tasks);
    const bgTaskLabel = Object.values(bgTasks)[0] ?? null;
    const vpVehicles = useVehicleStore((s: any) => s.viewportVehicleInfo);

    useEffect(() => {
        if (!schemaLoading) fetchLayerSchema()
    }, [fetchLayerSchema]);

    useLayerInit();
    useMapInit(openlayersMapRef, cesiumMapRef);
    useSimulation();
    useMapSync();
    useNaverBaseMap(naverMapRef, naverEnabled);
    useLayer();
    useDefaultSelect();
    useDefaultMoveMouse();
    useNetworkDraw();
    useNetworkSelect();
    useNetworkStationModify();
    useOsmBboxDraw();
    useCoordPick();

    const getContainerWidth = useCallback(() => {
        return containerRef.current?.clientWidth ?? 0;
    }, []);

    useEffect(() => {
        const width = getContainerWidth();
        if (width > 0) setDividerX((prev) => prev == null ? Math.round(width / 2) : prev)
    }, []);

    useEffect(() => {
        const onResize = () => {
            const width = getContainerWidth();
            if (width === 0) return;
            setDividerX((prev) => {
                if (prev == null) return Math.round(width / 2);
                return Math.min(Math.max(prev, 120), width - 120)
            })
        };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, [getContainerWidth])

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing.current || !containerRef.current) return;
            const containerLeft = containerRef.current?.getBoundingClientRect().left || 0;
            setDividerX(e.clientX - containerLeft);
        };

        const handleMouseUp = () => {
            isResizing.current = false;
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, []);

    useEffect(() => {
        if (selecting) {
            prevModeRef.current = mapViewMode;
            setMapViewMode('2D');
        } else if (prevModeRef.current !== null) {
            setMapViewMode(prevModeRef.current);
            prevModeRef.current = null;
        }
    }, [selecting]);

    const handleMouseDown = () => {
        isResizing.current = true;
    };

    const containerWidth = getContainerWidth();
    const leftWidth = `${dividerX}px`;
    const rightWidth = `${Math.max(containerWidth - (dividerX ?? 0), 0)}px`;

    // 두 지도를 absolute로 겹쳐두고 visibility로 전환.
    // width:0 으로 숨기면 WebGL 컨텍스트가 중단되어 preRender 이벤트가 멈추고
    // 시뮬레이션 업데이트 루프가 끊기기 때문에 이 방식을 사용.
    const useStackedLayout = singleMapMode || mapViewMode !== 'split';
    const olVisible = mapViewMode !== '3D';
    const cesiumVisible = mapViewMode !== '2D';

    const olStyle = useStackedLayout
        ? {
            position: 'absolute' as const, inset: 0,
            visibility: olVisible ? 'visible' as const : 'hidden' as const,
            pointerEvents: olVisible ? 'auto' as const : 'none' as const,
            zIndex: olVisible ? 1 : 0,
          }
        : { width: leftWidth, transition: isResizing.current ? "none" : "width 0.3s ease" };

    const cesiumStyle = useStackedLayout
        ? {
            position: 'absolute' as const, inset: 0,
            visibility: cesiumVisible ? 'visible' as const : 'hidden' as const,
            pointerEvents: cesiumVisible ? 'auto' as const : 'none' as const,
            zIndex: cesiumVisible ? 1 : 0,
          }
        : { width: rightWidth, transition: isResizing.current ? "none" : "width 0.3s ease" };

    const isLoading = schemaLoading || !isInitialized;

    return (
        <div
            ref={containerRef}
            className={`${styles['container']} ${useStackedLayout ? styles['containerSingle'] : ''}`}
        >
            {coordPickActive && (
                <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10001,
                    background: 'rgba(30,100,220,0.88)',
                    color: '#fff',
                    padding: '9px 20px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    fontSize: 13,
                    pointerEvents: 'none',
                }}>
                    <span>지도를 클릭하여 네트워크 기준점을 선택하세요</span>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>ESC: 취소</span>
                </div>
            )}

            {isLoading && (
                <div style={{
                    position: 'absolute', inset: 0,
                    background: 'rgba(8,10,20,0.85)',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    zIndex: 9999,
                    gap: 16,
                }}>
                    <div style={{
                        width: 40, height: 40,
                        border: '3px solid rgba(255,255,255,0.15)',
                        borderTop: '3px solid rgba(100,160,255,0.9)',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                    }}/>
                    <span style={{ fontSize: 13, color: 'rgba(200,210,230,0.8)', letterSpacing: 1 }}>
                        데이터 로딩 중...
                    </span>
                </div>
            )}
            {!isLoading && (tileLoading || bgTaskLabel) && (
                <div style={{
                    position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
                    background: 'rgba(8,10,20,0.82)',
                    borderRadius: 20,
                    padding: '7px 16px',
                    display: 'flex', alignItems: 'center', gap: 10,
                    zIndex: 10000,
                    pointerEvents: 'none',
                }}>
                    <div style={{
                        width: 16, height: 16,
                        border: '2px solid rgba(255,255,255,0.15)',
                        borderTop: '2px solid rgba(100,160,255,0.9)',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                    }}/>
                    <span style={{ fontSize: 12, color: 'rgba(200,210,230,0.9)' }}>
                        {bgTaskLabel ?? '네트워크 로딩 중...'}
                    </span>
                </div>
            )}
            {!isLoading && vpVehicles && (
                <div style={{
                    position: 'absolute', bottom: 14, left: 14,
                    background: 'rgba(8,10,20,0.78)',
                    borderRadius: 14,
                    padding: '5px 12px',
                    display: 'flex', alignItems: 'center', gap: 7,
                    zIndex: 9000,
                    pointerEvents: 'none',
                    fontSize: 12,
                    color: 'rgba(210,218,235,0.92)',
                }}>
                    <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: vpVehicles.dense ? 'rgba(255,150,60,0.95)' : 'rgba(90,210,120,0.95)',
                    }}/>
                    {vpVehicles.dense
                        ? <span>차량 {vpVehicles.total.toLocaleString()}대 — 히트맵 표시</span>
                        : <span>차량 {vpVehicles.shown.toLocaleString()}대 표시
                            {vpVehicles.total > vpVehicles.shown ? ` / 전체 ${vpVehicles.total.toLocaleString()}대` : ''}</span>}
                </div>
            )}
            <ToolsPanel/>
            <NodeContextMenu/>

            {!ONLY_3D && (
                <div className={styles.mapModeToggle} title={isNetworkEditActive ? '편집 모드 중 전환 불가' : undefined}>
                    <button
                        className={mapViewMode === '2D' ? styles.mapModeBtnActive : styles.mapModeBtn}
                        onClick={() => !isNetworkEditActive && setMapViewMode('2D')}
                        disabled={isNetworkEditActive}
                        style={isNetworkEditActive ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                    >
                        2D
                    </button>
                    {!singleMapMode && (
                        <button
                            className={mapViewMode === 'split' ? styles.mapModeBtnActive : styles.mapModeBtn}
                            onClick={() => !isNetworkEditActive && setMapViewMode('split')}
                            disabled={isNetworkEditActive}
                            style={isNetworkEditActive ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                        >
                            분할
                        </button>
                    )}
                    <button
                        className={mapViewMode === '3D' ? styles.mapModeBtnActive : styles.mapModeBtn}
                        onClick={() => !isNetworkEditActive && setMapViewMode('3D')}
                        disabled={isNetworkEditActive}
                        style={isNetworkEditActive ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                    >
                        3D
                    </button>
                </div>
            )}

            {/* 네이버 배경 지도 (읽기 전용): OL 영역에 정확히 겹쳐 깔림(절대위치). OL 배경타일을 끄면 비쳐 보인다.
                분할 모드에서 OL 은 좌측 leftWidth 를 차지하므로 네이버도 그 폭에 맞춘다. */}
            {!ONLY_3D && naverEnabled && (
                <div
                    ref={naverMapRef}
                    style={{
                        position: 'absolute' as const,
                        top: 0, left: 0, bottom: 0,
                        width: useStackedLayout ? '100%' : leftWidth,
                        zIndex: 0,
                        pointerEvents: 'none' as const,
                    }}
                />
            )}

            {!ONLY_3D && (
                <MapOL
                    ref={openlayersMapRef}
                    style={olStyle}
                    className={styles['map']}
                />
            )}

            {!singleMapMode && mapViewMode === 'split' && !ONLY_3D && <Divider onMouseDown={handleMouseDown}/>}

            <MapCesium
                ref={cesiumMapRef}
                style={ONLY_3D ? { width: '100%', height: '100%' } : cesiumStyle}
                className={styles['map']}
            />
        </div>
    );
};

export default Maps;