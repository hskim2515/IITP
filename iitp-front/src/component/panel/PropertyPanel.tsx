import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import "/static/css/styles.css";
import { MenuTree } from "@stores/useMenuStore";
import { propertyFormSchema } from "../form/propertyFormSchema";
import Grid from "../util/Grid";
import { buildColumnDefs, featureCollectionToFlatRow, } from "@utils/grid";
import { ColDef } from "ag-grid-community";
import { GridHandle } from "@type/GirdOptions";
import { menuCodeToStoreMap } from "@hooks/useFeatureInit";
import { useEventStore } from "@stores/useEventStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import useGrid, { AddOptions } from "@hooks/useGrid";
import GeometryType from "@type/FeatureOptions";
import { SelectEvent } from "ol/interaction/Select";
import { Feature } from "ol";
import VectorLayer from "ol/layer/Vector";
import BaseLayer from "ol/layer/Base";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import { ModifyEvent } from "ol/interaction/Modify";
import { DrawEvent } from "ol/interaction/Draw";
import { GeoJSON } from "ol/format";
import { apiConfig, ApiMenuKey } from "../../config/apiConfig";
import axiosInstance from "../../api/axiosInstance";
import { EventManager } from "@managers/EventManager";

export interface BottomTableProps {
    activeSubmenu: MenuTree
    onClose: () => void;
}

const geometryTypeOptions: GeometryType[] = [
    GeometryType.POINT,
    GeometryType.LINE_STRING,
    GeometryType.POLYGON,
];
const PropertyPanel = ({ activeSubmenu, onClose }: BottomTableProps) => {
    const submenu = {
        menuCode: activeSubmenu.menuCode,
        item: propertyFormSchema[activeSubmenu.menuCode],
        title: activeSubmenu.nameKor
    }

    const gridRef = useRef<GridHandle>(null)
    const [ rowData, setRowData ] = useState<Record<string, unknown>[]>([])
    const [ colDefs, setColDefs ] = useState<ColDef[] | undefined>(undefined)

    // 동적 스토어
    const store = menuCodeToStoreMap[submenu.menuCode];

    const olEventManager: EventManager = useEventStore.getState().olEventManager;
    const [ drawGeometryType, setDrawGeometryType ] = useState<GeometryType>(GeometryType.POINT)

    const selectedFeatureIdRef = useRef<[]>([]);
    const [ addedData, setAddedData ] = useState<AddOptions>({
        baseData: {},
        defaultGeometry: {}
    })

    const [ isEditable, setIsEditable ] = useState<boolean>(false)
    const [ isDrawing, setIsDrawing ] = useState<boolean>(false)

    const map = useOpenLayersStore.state.map()

    const networkLayer = useMemo(() => {
        return map?.getLayers().getArray()
            .find((layer: VectorLayer | BaseLayer | WebGLVectorLayer) => layer["layer"] === "NETWORK");
    }, [ map ]);

    const layer = useMemo(() => {
        return map?.getLayers().getArray()
            .find((layer: VectorLayer | BaseLayer | WebGLVectorLayer) => layer["layer"] === submenu.menuCode);
    }, [ map, submenu.menuCode ]);

    const layers = useMemo(() => {
        return map?.getLayers().getArray()
            .filter((layer: VectorLayer | BaseLayer | WebGLVectorLayer) => layer["layerGroup"] === "edit");
    }, [ map, submenu.menuCode ]);

    const {
        addRow,
        deleteSelected,
        saveModifiedFeatures,
        updateFeatureByRow,
        switchEditable
    } = useGrid(gridRef, store, colDefs)

    const onSnap = useCallback((e: any) => {

    }, [])
    useEffect(() => {

        const options = {
            olLayer: networkLayer,
        };

        olEventManager.bind("snap", onSnap, options);

        return () => {
            olEventManager.unbind("snap", onSnap);
        };
    }, [networkLayer, onSnap]);
    const onDrawEnd = (e: DrawEvent) => {
        const feature: Feature = e.feature;
        feature.set("id", Date.now());

        const format = new GeoJSON({ featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' });
        const geojsonFeature = format.writeFeatureObject(feature);

        const defaultGeometry = geojsonFeature.geometry;

        saveModifiedFeatures([ feature ]);
        const baseData = addedData?.baseData ?? {};
        addRow({ baseData, defaultGeometry })
        setIsDrawing(false)
    };
    useEffect(() => {
        const options = {
            olLayer: layer,
            drawGeometryType: drawGeometryType
        };

        if (isDrawing) {
            olEventManager.bind("drawend", onDrawEnd, options);
        } else {
            olEventManager.unbind("drawend", onDrawEnd);
        }

        return () => {
            olEventManager.unbind("drawend", onDrawEnd);
        };
    }, [ olEventManager, layer, isDrawing, drawGeometryType, onDrawEnd ]);
    const onModifyEnd = (e: ModifyEvent) => {

        const features: Feature[] = e.features.getArray();
        saveModifiedFeatures(features);


    };
    useEffect(() => {
        const options = {
            olLayer: layer,
        };

        if (isEditable) {
            olEventManager.bind("modifyend", onModifyEnd, options);
        }

        return () => {
            olEventManager.unbind("modifyend", onModifyEnd);
        };
    }, [ olEventManager, layer, isEditable, onModifyEnd ]);
    const onSelect = (e: SelectEvent) => {

        const targets = e.target.getFeatures().getArray();

        e.selected.forEach((feature) => {
            feature.set("selected", true);
        });

        e.deselected.forEach((feature) => {
            feature.set("selected", false);
        });

        const selectedIds = targets
            .map((feature: Feature) => feature.get("id"))
            .filter((id: string | number) => id !== undefined);

        const prevIds = selectedFeatureIdRef.current;
        const isChanged = JSON.stringify(prevIds) !== JSON.stringify(selectedIds);

        if (isChanged) {
            const firstFeature = selectedIds[0];
            if (firstFeature !== undefined) {
                gridRef.current?.setSelectRowsWithField("id", firstFeature);
            }
            selectedFeatureIdRef.current = selectedIds;
        }
        const baseData = targets[0].get("properties")
        setAddedData({ baseData })
    };
    useEffect(() => {
        const options = {
            olLayers: layers,
        }
        if (layer) olEventManager.bind("select", onSelect, options)
        return () => {
            if (layer) olEventManager.unbind("select", onSelect)
        };
    }, [ olEventManager, layers, layer, onSelect ]);

    const handleCheck = () => {
        console.log("체크한 row:", gridRef.current?.getSelectedRow());
        console.log("그리드 업데이트 확인:", gridRef.current?.isGridChanged());
        console.log("changed?", gridRef.current?.getChangedValue())
        console.log("currentGeojson:", store.getState().currentGeojson) // 디버깅용
    };

    // currentGeojson 기반으로 Grid용 데이터 가공
    useEffect(() => {
        console.log("rowData menu:::", submenu.menuCode)
        console.log("submenu.item:::", submenu.item)
        if (!submenu.menuCode || !submenu.item?.fields) return;
        if (!store) {
            setRowData([])
            return;
        }
        console.log("rowData store.getState():::", store.getState())
        const currentGeojson = store.getState().currentGeojson
        if (currentGeojson == undefined) return;
        const flatRow = featureCollectionToFlatRow(currentGeojson);

        console.log("rowData currentGeojson:::", currentGeojson)
        console.log("rowData flatRow:::", flatRow)
        store.getState().setFlatRow(flatRow)
        setRowData(flatRow);
        const defs = buildColumnDefs(submenu.item.fields);
        setColDefs(defs);

    }, [ submenu.menuCode ]);

    const handleGridSelectionChanged = () => {
        const selectedRows = gridRef.current?.getSelectedRow() ?? [];
        const selectedIds = selectedRows.map((row: Record<string, unknown>) => row.id);

        const source = layer.getSource();
        const features = source?.getFeatures() ?? [];

        features.forEach((feature: Feature) => {
            const fid = feature.get("id");
            const selected = selectedIds.includes(fid);
            feature.set("selected", selected);
        });
        selectedFeatureIdRef.current = selectedIds;
    };

    const handleAddBtn = () => {
        const baseData = addedData?.baseData ?? {};
        addRow({ baseData });
    }
    const handleDrawBtn = () => {
        setIsDrawing(!isDrawing)
    }
    const handleDeleteBtn = () => {
        deleteSelected()
    }

    const handleSaveBtn = async () => {
        const api = apiConfig[submenu.menuCode as ApiMenuKey].update;
        const geojson = store.getState().currentGeojson;
        const payload = {
            name: submenu.menuCode,
            geojson,
        };
        try {
            await axiosInstance({
                method: api.method,
                url: api.url,
                data: payload,
            });

            console.log("저장 완료:",);
        } catch (error) {
            console.error("저장 실패:", error);
        }
    }

    const handleEditableBtn = () => {
        setIsEditable(!isEditable);
        switchEditable(!isEditable);
    }

    const handleInitBtn = () => {
        store.getState().initCurrentData()
        const restoredGeojson = store.getState().currentGeojson;
        if (restoredGeojson == undefined) return;
        const restoredFlatRow = featureCollectionToFlatRow(restoredGeojson);

        store.getState().setFlatRow(restoredFlatRow);
        setRowData(restoredFlatRow);
    }

    return (
        <>
            <div className={ `popup-overlay${ submenu.item.type ? `-${ submenu.item.type }` : '' }` }>
                <div className={ `popup-container${ submenu.item.type ? `-${ submenu.item.type }` : '' }` }>
                    <div className="popup-header">
                        <span>{ submenu.title }</span>
                        <div className="popup-header-actions">
                            <select
                                value={ drawGeometryType ?? '' }
                                onChange={ (e) => setDrawGeometryType(e.target.value as GeometryType) }
                            >
                                { geometryTypeOptions.map(type => (
                                    <option key={ type } value={ type }>{ type }</option>
                                )) }
                            </select>
                            <button className="add-btn" onClick={ () => handleAddBtn() }>추가</button>
                            <button className="add-btn" onClick={ () => handleDrawBtn() }>{ !isDrawing ? '그리기' : '그리기 취소' }</button>
                            <button className="delete-btn" onClick={ () => handleDeleteBtn() }>삭제</button>
                            <button className="save-btn" onClick={ () => handleSaveBtn() }>저장</button>
                            <button className="save-btn" onClick={ () => handleInitBtn() }>되돌리기</button>
                            <button className="edit-btn" onClick={ () => handleEditableBtn() }>{ !isEditable ? '편집 활성화' : '편집 비활성화' }</button>
                            <button onClick={ () => handleCheck() }>Interaction 객체 목록 디버깅</button>
                        </div>
                        <button className="close-btn" onClick={ onClose }>×</button>
                    </div>
                    <div className="popup-body">
                        { submenu.item && colDefs &&
                            <Grid
                                ref={ gridRef }
                                colDefs={ colDefs }
                                rowData={ rowData }
                                onCellValueChanged={ updateFeatureByRow }
                                onSelectionChanged={ handleGridSelectionChanged }
                            />
                        }
                    </div>
                </div>
            </div>

        </>
    );
};

export default PropertyPanel;