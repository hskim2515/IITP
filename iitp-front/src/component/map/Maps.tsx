import React, { useCallback, useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import MapCesium from "@component/map/MapCesium";
import MapOL from "@component/map/MapOL";
import useMapInit from "@hooks/useMapInit";
import useSimulation from "@hooks/useSimulation";
import useMapSync from "@hooks/sync/useMapSync";
import useLayer from "@hooks/useLayer";
import { useLayerSchemaStore } from "@stores/useLayerSchemaStore";
import useLayerInit from "@hooks/useLayerInit";
import useDefaultSelect from "@hooks/sync/select/useDefaultSelect";
import '../../App.css'
import useDefaultMoveMouse from "@hooks/sync/move/useDefaultMoveMouse";
import styles from "@css/Maps.module.css"
import Divider from "@component/map/Divider";
import ToolsPanel from "@component/tool/ToolsPanel";
import { useNetworkDraw } from "@hooks/useNetworkDraw";

const Maps = () => {

    const containerRef = useRef<HTMLDivElement | null>(null);
    const openlayersMapRef = useRef<HTMLDivElement | undefined>(undefined);
    const cesiumMapRef = useRef<Element | null>(null);
    const isResizing = useRef(false);

    const [dividerX, setDividerX] = useState<number | null>(null);

    const {fetchLayerSchema, loading} = useLayerSchemaStore();

    useEffect(() => {
        if (!loading) fetchLayerSchema()
    }, [fetchLayerSchema]);

    useLayerInit();
    useMapInit(openlayersMapRef, cesiumMapRef);
    useSimulation();
    useMapSync();
    useLayer();
    useDefaultSelect();
    useDefaultMoveMouse();
    useNetworkDraw();

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

    return (
        <div
            ref={containerRef}
            className={styles['container']}
        >
            <ToolsPanel/>
            <MapOL
                ref={openlayersMapRef}
                style={{
                    width: leftWidth,
                    transition: isResizing.current ? "none" : "width 0.3s ease"
                }}
                className={styles['map']}
            />

            <Divider
                onMouseDown={handleMouseDown}
            />

            <MapCesium
                ref={cesiumMapRef}
                style={{
                    width: rightWidth,
                    transition: isResizing.current ? "none" : "width 0.3s ease"
                }}
                className={styles['map']}
            />
        </div>
    );
};

export default Maps;