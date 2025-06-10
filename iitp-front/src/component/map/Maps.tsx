import React, { useEffect, useRef } from 'react';
import 'ol/ol.css';
import MapCesium from "./MapCesium";
import MapOL from "./MapOL";
import useMapInit from "@hooks/useMapInit";
import useSimulation from "@hooks/useSimulation";
import useMapSync from "@hooks/useMapSync";
import useLayer from "@hooks/useLayer";
import { useLayerSchemaStore } from "@stores/useLayerSchemaStore";
import useSelect from "../../hooks/select/useSelect";
import useFeatureInit from "@hooks/useFeatureInit";
import { useMenuStore } from "@stores/useMenuStore";

const Maps = () => {

    const openlayersMapRef = useRef(null);
    const cesiumMapRef = useRef(null);

    const activeSubmenu = useMenuStore.state.activeSubmenu()

    const panelWidth = activeSubmenu ? 250 : 0; // 패널이 열리면 250px 너비 적용
    const mapWidth = `calc((100vw - ${ panelWidth }px) / 2)`; // 패널이 열리면 남은 공간을 2등분

    const fetchLayerSchema = useLayerSchemaStore.actions.fetchLayerSchema()

    useEffect(() => {
        fetchLayerSchema()
    }, [ fetchLayerSchema ]);

    useFeatureInit()
    useMapInit(openlayersMapRef, cesiumMapRef);
    useSimulation();
    useMapSync();
    useLayer();
    useSelect();


    return (

        <div style={{ position: 'fixed', top: '50px', width: '100vw', height: '100vh' }}>
            <div style={{ display: "flex", transition: "margin 0.3s ease", float: "inline-end" }}>
                <MapOL ref={ openlayersMapRef } style={{ width: mapWidth, transition: "width 0.3s ease" }}/>
                <MapCesium ref={ cesiumMapRef } style={{ width: mapWidth, transition: "width 0.3s ease" }}/>
            </div>
        </div>
    );
};

export default Maps;