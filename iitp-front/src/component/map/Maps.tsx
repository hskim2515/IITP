import React, { useCallback, useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import MapCesium from "@component/map/MapCesium";
import MapOL from "@component/map/MapOL";
import useMapInit from "@hooks/useMapInit";
import useSimulation from "@hooks/useSimulation";
import useMapSync from "@hooks/sync/useMapSync";
import useLayer from "@hooks/useLayer";
import { useLayerSchemaStore } from "@stores/useLayerSchemaStore";
import { useLayerStore } from "@stores/useLayerStore";
import useLayerInit from "@hooks/useLayerInit";
import useDefaultSelect from "@hooks/sync/select/useDefaultSelect";
import '../../App.css'
import useDefaultMoveMouse from "@hooks/sync/move/useDefaultMoveMouse";
import styles from "@css/Maps.module.css"
import Divider from "@component/map/Divider";
import ToolsPanel from "@component/tool/ToolsPanel";
import { useNetworkDraw } from "@hooks/useNetworkDraw";
import { useOsmBboxDraw } from "@hooks/useOsmBboxDraw";

interface MapsProps {
    singleMapMode?: boolean;
    mapMode?: '2D' | '3D';
    onMapModeChange?: (mode: '2D' | '3D') => void;
}

const Maps = ({ singleMapMode = false, mapMode = '2D', onMapModeChange }: MapsProps) => {

    const containerRef = useRef<HTMLDivElement | null>(null);
    const openlayersMapRef = useRef<HTMLDivElement | undefined>(undefined);
    const cesiumMapRef = useRef<Element | null>(null);
    const isResizing = useRef(false);

    const [dividerX, setDividerX] = useState<number | null>(null);

    const {fetchLayerSchema, loading: schemaLoading} = useLayerSchemaStore();
    const isInitialized = useLayerStore((s) => s.isInitialized);

    useEffect(() => {
        if (!schemaLoading) fetchLayerSchema()
    }, [fetchLayerSchema]);

    useLayerInit();
    useMapInit(openlayersMapRef, cesiumMapRef);
    useSimulation();
    useMapSync();
    useLayer();
    useDefaultSelect();
    useDefaultMoveMouse();
    useNetworkDraw();
    useOsmBboxDraw();

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

    const handleMouseDown = () => {
        isResizing.current = true;
    };

    const containerWidth = getContainerWidth();
    const leftWidth = `${dividerX}px`;
    const rightWidth = `${Math.max(containerWidth - (dividerX ?? 0), 0)}px`;

    // singleMapMode: 두 지도를 absolute로 겹쳐두고 visibility로 전환.
    // width:0 으로 숨기면 WebGL 컨텍스트가 중단되어 preRender 이벤트가 멈추고
    // 시뮬레이션 업데이트 루프가 끊기기 때문에 이 방식을 사용.
    const olStyle = singleMapMode
        ? {
            position: 'absolute' as const, inset: 0,
            visibility: mapMode === '2D' ? 'visible' as const : 'hidden' as const,
            pointerEvents: mapMode === '2D' ? 'auto' as const : 'none' as const,
            zIndex: mapMode === '2D' ? 1 : 0,
          }
        : { width: leftWidth, transition: isResizing.current ? "none" : "width 0.3s ease" };

    const cesiumStyle = singleMapMode
        ? {
            position: 'absolute' as const, inset: 0,
            visibility: mapMode === '3D' ? 'visible' as const : 'hidden' as const,
            pointerEvents: mapMode === '3D' ? 'auto' as const : 'none' as const,
            zIndex: mapMode === '3D' ? 1 : 0,
          }
        : { width: rightWidth, transition: isResizing.current ? "none" : "width 0.3s ease" };

    const isLoading = schemaLoading || !isInitialized;

    return (
        <div
            ref={containerRef}
            className={`${styles['container']} ${singleMapMode ? styles['containerSingle'] : ''}`}
        >
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
            <ToolsPanel/>

            {singleMapMode && (
                <div className={styles.mapModeToggle}>
                    <button
                        className={mapMode === '2D' ? styles.mapModeBtnActive : styles.mapModeBtn}
                        onClick={() => onMapModeChange?.('2D')}
                    >
                        2D
                    </button>
                    <button
                        className={mapMode === '3D' ? styles.mapModeBtnActive : styles.mapModeBtn}
                        onClick={() => onMapModeChange?.('3D')}
                    >
                        3D
                    </button>
                </div>
            )}

            <MapOL
                ref={openlayersMapRef}
                style={olStyle}
                className={styles['map']}
            />

            {!singleMapMode && <Divider onMouseDown={handleMouseDown}/>}

            <MapCesium
                ref={cesiumMapRef}
                style={cesiumStyle}
                className={styles['map']}
            />
        </div>
    );
};

export default Maps;