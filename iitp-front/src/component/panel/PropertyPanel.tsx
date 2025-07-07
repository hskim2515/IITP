import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import "/static/css/styles.css";
import { MenuTree } from "@stores/useMenuStore";
import { propertyFormSchema } from "../form/propertyFormSchema";
import Grid from "../util/Grid";
import { buildColumnDefs, featureCollectionToFlatRow, } from "@utils/grid";
import { ColDef } from "ag-grid-community";
import { GridHandle } from "@type/GirdOptions";
import { menuCodeToStoreMap } from "@hooks/useLayerInit";
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
import JsonGrid from "../util/JsonGrid";
import {faChevronDown, faChevronUp} from "@fortawesome/free-solid-svg-icons";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import useHistoryInit, {menuCodeToHistoryStoreMap} from "@hooks/useHistoryInit";
import {mergeJsonWithLog, mergeUpdateLogs} from "@utils/history";
import {interpolateByOffset} from "@utils/interpolateByOffset";
import HistoryController from "../modal/HistoryController";
import {menuDrawRequirements} from "../../config/menuDrawConfig";
import TypeSelectionModal from "../modal/TypeSelectionModal";
import HistoryModal from "../modal/HistoryModal";
import {getLinkLaneCellInfo} from "@utils/getPavementMarkingInfo";
import {useScenarioStore} from "@stores/useScenarioStore";

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
    const historyStore = menuCodeToHistoryStoreMap[submenu.menuCode];

    const eventManager = useEventStore.getState().olEventManager;
    const [ drawGeometryType, setDrawGeometryType ] = useState<GeometryType>(GeometryType.POINT)

    const selectedFeatureIdRef = useRef<[]>([]);
    const [ addedData, setAddedData ] = useState<AddOptions>({})

    const [ isEditable, setIsEditable ] = useState<boolean>(false)
    const [ isDrawing, setIsDrawing ] = useState<boolean>(false)
    const [isTypeSelect, setIsTypeSelect] = useState(false);
    const [onConfirm, setOnConfirm] = useState<((selected: string) => void) | null>(null);

    const [expandedKey, setExpandedKey] = useState<string | null>(null);

    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [ selectedType, setSelectedType ] = useState<String>()

    const selectedScenario = useScenarioStore.getState().selectedScenario;

    const map = useOpenLayersStore.state.map()

    const layer = useMemo(() => {
        return map?.getLayers().getArray()
            .find((layer: VectorLayer | BaseLayer | WebGLVectorLayer) => layer["layer"] === submenu.item?.layer);
    }, [ map, submenu.menuCode ]);


    const toggleGrid = (key: string) => {
        setExpandedKey((prevKey) => (prevKey === key ? null : key)); // 같은 key면 닫기
    };

    const layers = useMemo(() => {
        return map?.getLayers().getArray()
            .filter((layer: VectorLayer | BaseLayer | WebGLVectorLayer) => layer["layerGroup"] === "facility");
    }, [ map, submenu.menuCode ]);

    const [reloadFlag, setReloadFlag] = useState(false);

    useHistoryInit(reloadFlag);

    const {
        addRow,
        deleteSelected,
        saveModifiedFeatures,
        updateFeatureByRow,
        switchEditable
    } = useGrid(gridRef, store, historyStore, colDefs)

    const onDrawEnd = (e: DrawEvent) => {
        const feature: Feature = e.feature;
        const selected = 1;
        feature.set("id", Date.now());
        feature.set("selected", selected);
        feature.changed();
        const format = new GeoJSON({ featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' });
        const geojsonFeature = format.writeFeatureObject(feature);

        const defaultGeometry = geojsonFeature.geometry;

        saveModifiedFeatures([ feature ]);

        const baseData = addedData?.baseData ?? {};
        addRow({ baseData, defaultGeometry })
        setIsDrawing(false)
    };

    // const onDrawEnd = (e: DrawEvent) => {
    //     const feature = e.feature;
    //     const coord = feature.getGeometry().getCoordinates();
    //     const result = getLinkLaneCellInfo(map, coord);
    //     const { linkId, laneId, cellId, offset, angle, iconPosition } = result;
    //     const selected = 1;
    //     feature.set("id", Date.now());
    //     feature.set("selected", selected);
    //
    //     feature.set("markingType", selectedType);
    //     feature.set("linkRef", parseInt(linkId));
    //     feature.set("laneRef", parseInt(laneId));
    //     feature.set("cellId", parseInt(cellId));
    //     feature.set("offset", parseInt(offset));
    //     feature.set("angle", angle);
    //
    //     feature.changed();
    //     const format = new GeoJSON({ featureProjection: 'EPSG:3857', dataProjection: 'EPSG:4326' });
    //     const geojsonFeature = format.writeFeatureObject(feature);
    //     const defaultProperties = geojsonFeature.properties;
    //     const defaultGeometry = geojsonFeature.geometry;
    //
    //     // if (defaultProperties.position) {
    //     //     const originalCoord = defaultProperties.position;
    //     //     const transformed = transform(originalCoord, 'EPSG:3857', 'EPSG:4326');
    //     //     defaultGeometry.coordinates = transformed;
    //     // }
    //
    //     saveModifiedFeatures([ feature ]);
    //
    //     const baseData = addedData?.baseData ?? {};
    //     addRow({ baseData, defaultGeometry, defaultProperties})
    //     setIsDrawing(false)
    // };

    useEffect(() => {
        if (!eventManager || !submenu.menuCode || !map || !layer) return;

        const options = {
            olLayer: layer,
            drawGeometryType: drawGeometryType
        };

        if (isDrawing) {
            eventManager.bind("drawend", onDrawEnd, options);
        } else {
            eventManager.unbind("drawend", onDrawEnd);
        }

        return () => {
            eventManager.unbind("drawend", onDrawEnd);
        };
    }, [ isDrawing, submenu.menuCode, onDrawEnd ]);

    const onModifyEnd = useCallback((e: ModifyEvent) => {

        const features: Feature[] = e.features.getArray();
        saveModifiedFeatures(features);

        const selected = 1;

        features.forEach(feature => {
            feature.set("selected", selected);
            feature.changed();
        });

    }, []);
    useEffect(() => {
        if (!eventManager || !submenu.menuCode || !map || !layer) return;

        const options = {
            olLayer: layer,
        };

        if (isEditable) {
            eventManager.bind("modifyend", onModifyEnd, options);
        } else {
            eventManager.unbind("modifyend", onModifyEnd);
        }

        return () => {
            eventManager.unbind("modifyend", onModifyEnd);
        };
    }, [ isEditable, submenu.menuCode, onModifyEnd ]);

    const onSelect = useCallback((e: SelectEvent) => {

        const targets = e.target.getFeatures().getArray();

        const isEditingLayer = (feature: Feature) => layer.getSource().hasFeature(feature)

        // 원하는 레이어만 selected 속성 수정
        //선택된 feature에 selected = 1 설정
        e.selected.forEach((feature) => {
            if (isEditingLayer(feature)) {
                feature.set("selected", 1);
                feature.changed(); // 스타일} 갱신용
            }
        });
        // 선택 해제된 feature에 selected = 0 설정
        e.deselected.forEach((feature) => {
            if (isEditingLayer(feature)) {
                feature.set("selected", 0);
                feature.changed();
            }
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
    }, [ map, layers, submenu.menuCode ]);
    useEffect(() => {
        if (!eventManager || !submenu.menuCode || !map) return;

        const options = {
            olLayers: layers,
        }
        if (layer) eventManager.bind("select", onSelect, options)
        return () => {
            if (layer) eventManager.unbind("select", onSelect)
        };
    }, [ submenu.menuCode, onSelect ]);

    useEffect(() => {
        console.log("drawGeometryType:::", drawGeometryType)
    }, [ drawGeometryType ]);

    const handleCheck = () => {
        console.log("체크한 row:", gridRef.current?.getSelectedRow());
        console.log("그리드 업데이트 확인:", gridRef.current?.isGridChanged());
        console.log("changed?", gridRef.current?.getChangedValue())
        console.log("currentGeojson:", store.getState().currentGeojson) // 디버깅용
    };

    // currentGeojson 기반으로 Grid용 데이터 가공
    useEffect(() => {
        if (!submenu.menuCode || !submenu.item?.fields) return;
        if (!store) {
            setRowData([])
            return;
        }
        const currentGeojson = store.getState().currentGeojson
        if (currentGeojson == undefined) return;
        const flatRow = featureCollectionToFlatRow(currentGeojson);

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
            const selected = selectedIds.includes(fid) ? 1 : 0;
            feature.set("selected", selected);
            feature.changed();
        });
    };

    const handleAddBtn = () => {
        const baseData = addedData?.baseData ?? {};
        addRow({ baseData });
    }

    const handleDrawBtn = () => {
        setIsDrawing(true);
        const menuMeta = menuDrawRequirements[submenu.menuCode];
        if (!menuMeta?.requiresType) {
            setIsDrawing(true);
            return;
        }
        else{
            openTypeSelectionModal(menuMeta.typeKey!, (type: string) => {
                setSelectedType(type);
                setIsDrawing(true);
            });
        }
    };

    const openTypeSelectionModal = (typeKey: string, callback: (selected: string) => void) => {
        setOnConfirm(() => callback);
        setIsTypeSelect(true);
    };

    const handleDeleteBtn = () => {
        deleteSelected()
    }

    // const handleSaveBtn = async () => {
    //     const api = apiConfig[submenu.menuCode as ApiMenuKey].update;
    //     const geojson = store.getState().currentGeojson;
    //     const payload = {
    //         id: 2,
    //         name: "busStation",
    //         geojson,
    //     };
    //     try {
    //         await axiosInstance({
    //             method: api.method,
    //             url: api.url,
    //             data: payload,
    //         });
    //
    //         console.log("저장 완료:",);
    //     } catch (error) {
    //         console.error("저장 실패:", error);
    //     }
    // }

    const handleSaveBtn = async () => {
        const api = apiConfig[submenu.menuCode as ApiMenuKey].update;
        const geojson = store.getState().currentGeojson;
        const logJson = historyStore.getState().updateLogs;
        if(!logJson){
            alert('변경사항이 없습니다.');
            return
        }
        const mergedLog = mergeUpdateLogs(logJson);

        const payload = {
            geojson,
            logJson: mergedLog,
        };
        try {
            await axiosInstance({
                method: api.method,
                url: api.url+ '/' + selectedScenario.key,
                data: payload,
            });

            historyStore.getState().resetAllUpdates();
            setReloadFlag(prev => !prev);
            console.log("저장 완료:",);
            alert("저장 완료")
        } catch (error) {
            console.error("저장 실패:", error);
            alert("저장 실패")
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

    const handleShowHistory = () => {
        setIsHistoryOpen(true);
    }

    const handleHistoryApply = (isUndo: boolean) => {
        if (!historyStore) return;
        const historyFn = isUndo ? historyStore.getState().undo : historyStore.getState().redo;
        const updateHistory = historyFn();

        if (!updateHistory) {
            console.warn(isUndo ? "No more undo steps available." : "No more redo steps available.");
            return;
        }

        const currentGeojson = store.getState().currentGeojson;
        const featuresMap = new Map<string | number, Feature>();

        currentGeojson.features.forEach((feature) => {
            const id = feature.properties?.id;
            if (id != null) {
                featuresMap.set(id, { ...feature });
            }
        });

        const mergeJson = mergeJsonWithLog(featuresMap, updateHistory.json, isUndo);

        const format = new GeoJSON();
        const features = format.readFeatures(mergeJson, {
            featureProjection: "EPSG:4326",
            dataProjection: "EPSG:3857",
        });

        const interpolated = interpolateByOffset(features);

        const geojsonStr = format.writeFeatures(interpolated, {
            featureProjection: "EPSG:3857",
            dataProjection: "EPSG:4326",
        });

        const geojsonObj = JSON.parse(geojsonStr);
        store.getState().setCurrentGeojson(geojsonObj);

        const restoredFlatRow = featureCollectionToFlatRow(geojsonObj);
        store.getState().setFlatRow(restoredFlatRow);
        setRowData(restoredFlatRow);

        alert(isUndo ? "Undo 성공" : "Redo 성공");
    };

    return (
        <>
            <div className={ `popup-overlay${ submenu.item.type ? `-${ submenu.item.type }` : '' }` }>
                <div className={ `popup-container${ submenu.item.type ? `-${ submenu.item.type }` : '' }` }>
                    <div className="popup-header">
                        <span>{ submenu.title }</span>
                        <div className="popup-header-actions">
                            <select
                                value={drawGeometryType ?? ''}
                                onChange={(e) => setDrawGeometryType(e.target.value as GeometryType)}
                            >
                                {geometryTypeOptions.map(type => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                            <button className="add-btn" onClick={() => handleAddBtn()}>추가</button>
                            <button className="add-btn" onClick={() => handleDrawBtn()}>그리기</button>
                            <button className="delete-btn" onClick={() => handleDeleteBtn()}>삭제</button>
                            <button className="save-btn" onClick={() => handleSaveBtn()}>저장</button>
                            <button className="save-btn" onClick={() => handleInitBtn()}>되돌리기</button>
                            <HistoryController onHistoryAply={handleHistoryApply}></HistoryController>
                            <button className="edit-btn" onClick={() => handleEditableBtn()}>그리드 편집활성화</button>
                            <button onClick={() => handleCheck()}>Interaction 객체 목록 디버깅</button>
                            <button className="btn" onClick={() => handleShowHistory()}>변경 이력 보기</button>
                        </div>
                        <button className="close-btn" onClick={onClose}>×</button>
                    </div>
                    <div className="popup-body">
                        {isTypeSelect && (
                            <TypeSelectionModal typeKey={submenu.menuCode} onConfirm={(selectedType) => {onConfirm?.(selectedType);setIsTypeSelect(false);}} onCancel={() => setIsTypeSelect(false)}/>
                        )}
                        {isHistoryOpen && (
                            <HistoryModal
                                onClose={() => setIsHistoryOpen(false)}
                                open={isHistoryOpen}
                                setRowData={setRowData}
                                menuCode={activeSubmenu.menuCode}
                            />
                        )}
                            { submenu.item &&
                            //{ submenu.item && colDefs &&
                            // <Grid
                            //     ref={ gridRef }
                            //     colDefs={ colDefs }
                            //     rowData={ rowData }
                            //     onCellValueChanged={ updateFeatureByRow }
                            //     onSelectionChanged={ handleGridSelectionChanged }
                            // />
                            <div>
                                {Object.entries(store.getState().originData).map(([key, value]) => (
                                    Array.isArray(value) && value.length > 0 && (
                                        <div key={key} style={{ marginBottom: 24 }}>
                                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                                <h4 style={{ margin: 12 }}>
                                                    {key.charAt(0).toUpperCase() + key.slice(1)}
                                                </h4>
                                                <FontAwesomeIcon onClick={() => toggleGrid(key)} icon={expandedKey === key ? faChevronUp : faChevronDown} />
                                            </div>
                                            {expandedKey === key && (
                                                <JsonGrid rowData={value} levelName={key} />
                                            )}
                                        </div>
                                    )
                                ))}
                            </div>
                        }
                    </div>
                </div>
            </div>

        </>
    );
};

export default PropertyPanel;