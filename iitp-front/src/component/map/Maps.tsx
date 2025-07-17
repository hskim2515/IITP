import React, {Suspense, useEffect, useRef, useState} from 'react';
import 'ol/ol.css';
import MapCesium from "./MapCesium";
import MapOL from "./MapOL";
import { useMenuStore } from "@stores/useMenuStore";
import useMapInit from "@hooks/useMapInit";
import useSimulation from "@hooks/useSimulation";
import useMapSync from "@hooks/sync/useMapSync";
import useLayer from "@hooks/useLayer";
import { useLayerSchemaStore } from "@stores/useLayerSchemaStore";
import useLayerInit from "@hooks/useLayerInit";
import useDefaultSelect from "../../hooks/sync/select/useDefaultSelect";
import {useScenarioStore} from "@stores/useScenarioStore";
import '../../App.css'
import {useCesiumStore} from "@stores/useCesiumStore";
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import useHistoryInit from "@hooks/useHistoryInit";
import useDefaultMoveMouse from "@hooks/sync/move/useDefaultMoveMouse";

const Maps = () => {

    const openlayersMapRef = useRef(null);
    const cesiumMapRef = useRef(null);
    const containerRef = useRef(null);

    const activeSubmenu = useMenuStore.state.activeSubmenu()
    const activeDropdownMenu = useMenuStore.state.activeDropdownMenu()

    const panelWidth = (!activeSubmenu && activeDropdownMenu) ? 250 : 0; // 패널이 열리면 250px 너비 적용
    const mapWidth = `calc((100vw - ${ panelWidth }px) / 2)`; // 패널이 열리면 남은 공간을 2등분

    const isResizing = useRef(false);

    const [dividerPosition, setDividerPosition] = useState(window.innerWidth / 2);

    const fetchLayerSchema = useLayerSchemaStore.actions.fetchLayerSchema()

    const olMap = useOpenLayersStore.state.map();
    const cesiumViewer = useCesiumStore.getState().viewer;
    useEffect(() => {
        fetchLayerSchema()
    }, [fetchLayerSchema]);

    useLayerInit();
    useMapInit(openlayersMapRef, cesiumMapRef);
    useSimulation();
    useMapSync();
    useLayer();
    useDefaultSelect();
    useDefaultMoveMouse();

    // useEffect(() => {
    //     if (olMap) {
    //         useLayerInit(); // ✅ 맵 초기화가 완료된 후 실행
    //     }
    // }, [olMap]);




    // Mouse event handlers
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing.current) return;
            const containerLeft = containerRef.current?.getBoundingClientRect().left || 0;
            setDividerPosition(e.clientX - containerLeft);
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

    const containerWidth = window.innerWidth - panelWidth;
    const leftWidth = `${dividerPosition}px`;
    const rightWidth = `${containerWidth - dividerPosition}px`;

    return (
        <div
            ref={containerRef}
            style={{
                position: "fixed",
                top: "50px",
                left: `${panelWidth}px`,
                width: `calc(100vw - ${panelWidth}px)`,
                height: "90vh",
                display: "flex",
                overflow: "hidden",
                userSelect: isResizing.current ? "none" : "auto"
            }}
        >
            <MapOL
                ref={openlayersMapRef}
                style={{ width: leftWidth, transition: isResizing.current ? "none" : "width 0.3s ease" }}
            />

            {/* Divider / Slider */}
            <div
                onMouseDown={handleMouseDown}
                style={{
                    width: "6px",
                    cursor: "col-resize",
                    backgroundColor: "#ccc",
                    zIndex: 10
                }}
            />

            <MapCesium
                ref={cesiumMapRef}
                style={{ width: rightWidth, transition: isResizing.current ? "none" : "width 0.3s ease" }}
            />
        </div>
    );
};

export default Maps;