import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import "/static/css/styles.css";
import { MenuTree } from "@stores/useMenuStore";
import { propertyFormSchema } from "../form/propertyFormSchema";
import { buildColumnDefs, featureCollectionToFlatRow, } from "@utils/grid";
import { ColDef } from "ag-grid-community";
import { GridHandle } from "@type/GirdOptions";
import { menuCodeToStoreMap } from "@hooks/useLayerInit";
import { useEventStore } from "@stores/useEventStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
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
import { faChevronDown, faChevronUp } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { menuCodeToHistoryStoreMap } from "@hooks/useHistoryInit";
import { mergeGeojsonWithLog } from "@utils/mergeJsonWithLog";
import { interpolateByOffset } from "@utils/interpolateByOffset";
import HistoryController from "../modal/HistoryController";
import { menuDrawRequirements } from "../../config/menuDrawConfig";
import TypeSelectionModal from "../modal/TypeSelectionModal";
import HistoryModal from "../modal/HistoryModal";
import { useSelectionStore } from "@stores/useSelectionStore";
import {
    filterFeaturesByIds,
    findFeaturesToFeature,
    getFeaturesByIdsFromLayer,
    getFeaturesByPropertyFromLayer,
    getFromToCoordinates,
    getOffsetOnFeature,
    getValuesFromFeatures
} from "@utils/feature";
import { useBusStationStore } from "@stores/useBusStationStore";
import { Select } from "ol/interaction";
import { toLonLat } from "ol/proj";
import Collection from "ol/Collection";
import { generateTrafficTypesGUID } from "@utils/guid";

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
    const selectedGuid = useSelectionStore((state) => state.selectedGuid)
    const setSelectedGuid = useSelectionStore((state) => state.setSelectedGuid)
    const addSelectionId = useSelectionStore((state) => state.addSelectionId)
    const clearSelected = useSelectionStore((state) => state.clearSelected)
    const removeSelectionId = useSelectionStore((state) => state.removeSelectionId)
    const selectedGuidRef = useRef<[]>([])
    const historyStore = menuCodeToHistoryStoreMap[submenu.menuCode];

    const [ currentJsonData, setCurrentJsonData ] = useState(store.getState().currentJsonData);
    const initCurrentData = store.getState().initCurrentData;

    const olEventManager = useEventStore.getState().olEventManager;
    const [ drawGeometryType, setDrawGeometryType ] = useState<GeometryType>(GeometryType.POINT)

    const selectInteractionRef = useRef<Select | undefined>(undefined);
    const selectedFeatureIdRef = useRef()
    const snappedPropertiesRef = useRef<Record<string, string | number | undefined>>(undefined);

    const [ isEditable, setIsEditable ] = useState<boolean>(false)
    const [ isDrawing, setIsDrawing ] = useState<boolean>(false)
    const [ isTypeSelect, setIsTypeSelect ] = useState(false);
    const [ onConfirm, setOnConfirm ] = useState<((selected: string) => void) | null>(null);

    const [ expandedKey, setExpandedKey ] = useState<string | null>(null);

    const [ isHistoryOpen, setIsHistoryOpen ] = useState(false);
    const [ selectedType, setSelectedType ] = useState<String>()

    const map = useOpenLayersStore.state.map()
    const olMap = useOpenLayersStore.state.map()

    useEffect(() => {
        const unsubscribe = store.subscribe(
            (state) => state.currentJsonData,
            (newJsonData) => {
                console.log("currentJsonData 변경됨::", newJsonData);
                setCurrentJsonData(newJsonData); // 갱신 트리거
            }
        );
        return () => unsubscribe();
    }, []);

    const layer = useMemo(() => {
        return olMap?.getLayers().getArray()
            .find((targetLayer: VectorLayer | BaseLayer | WebGLVectorLayer) => targetLayer["layer"] === submenu.item?.layer);
    }, [ olMap, submenu.menuCode ]);

    useEffect(() => {
        if (!selectedGuidRef || !layer) return;

        const allFeatures = layer.getSource().getFeatures();
        const prevGuids = selectedGuidRef.current || [];
        const nextGuids = selectedGuid || [];

        // 선택 해제 > 기본 스타일 적용
        const deselected = prevGuids.filter((id) => !nextGuids.includes(id));
        const deselectedFeatures = filterFeaturesByIds(allFeatures, deselected);
        deselectedFeatures.forEach((f) => {
            if(typeof layer.getDefaultStyle ==="function") {
                f.setStyle(layer.getDefaultStyle())
            }
        });

        // 선택 > 선택 스타일 적용
        const newlySelected = nextGuids.filter((id) => !prevGuids.includes(id));
        const selectedFeatures = filterFeaturesByIds(allFeatures, newlySelected);
        selectedFeatures.forEach((f) => {
            if(typeof layer.getSelectStyle ==="function") {
                f.setStyle(layer.getSelectStyle())
            }
        });

        // 상태 갱신
        selectedGuidRef.current = nextGuids;
    }, [ selectedGuid ]);

    const snapLayer = useMemo(() => {
        return olMap?.getLayers().getArray()
            .find((targetLayer: VectorLayer | BaseLayer | WebGLVectorLayer) =>
                targetLayer["layer"] === layer.getSnapLayerKey()
            );
    }, [ olMap, submenu.menuCode, layer ]);

    const toggleGrid = (key: string) => {
        setExpandedKey((prevKey) => (prevKey === key ? null : key)); // 같은 key면 닫기
    };

    const layers = useMemo(() => {
        return olMap?.getLayers().getArray()
            .filter((layer: VectorLayer | BaseLayer | WebGLVectorLayer) => layer["layerGroup"] === "facility");
    }, [ olMap, submenu.menuCode ]);

    useEffect(() => {
        if (!olEventManager || !submenu.menuCode || !map || !layer) return;
        const onDrawEnd = (e: DrawEvent) => {
            setIsDrawing(false)
            // generateTrafficTypesGUID()
            const id = Date.now()
            let featureType;
            if(typeof layer.getFeatureType === "function") {
                featureType = layer.getFeatureType()
            } else {
                featureType = submenu.item?.layer
            }

            const guid = generateTrafficTypesGUID(featureType)

            const feature: Feature = e.feature;
            feature.setProperties({
                id,
                __guid: guid
            })
            // selection id 추가
            setSelectedGuid([ feature.get("__guid") ])
            const drewProperties = feature.getProperties()

            const snappedProperties = snappedPropertiesRef?.current
            const snapFilter = { featureType }

            const snapFeatures = getFeaturesByPropertyFromLayer(snapLayer, snapFilter)
            const snapFeature = findFeaturesToFeature(snapFeatures, snappedProperties)
            const { startPosition } = getFromToCoordinates(e.feature)
            const offset = getOffsetOnFeature(snapFeature, startPosition)

            const [ lng, lat ] = toLonLat(startPosition)

            const mergedSnapProps = {
                lng,
                lat,
                offset,
                ...snappedProperties
            }
            let dto;
            if(typeof layer.recordToDto === "function") {
                dto = layer.snapPropertiesToDto(mergedSnapProps, layer.recordToDto(drewProperties))
            } else {
                console.error("properties를 json 형식으로 변환해주는 메서드 생성 필요")
                {
                    dto = {
                        mergedSnapProps,
                        ...drewProperties
                    }
                }
            }

            console.log("draw dto:::", dto)

            store.getState().updateCurrentJsonData(dto);
        }
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
    }, [ isDrawing, submenu.menuCode ]);

    useEffect(() => {
        if (!olEventManager || !submenu.menuCode || !map || !layer) return;
        const onModifyEnd = (e: ModifyEvent) => {
            const features: Collection<Feature> = e.features;
            const modifiedIds = getValuesFromFeatures(features, "__guid")
            setSelectedGuid(modifiedIds)

            const modifiedFeature = e.features.getArray()[0]

            const snappedProperties = snappedPropertiesRef?.current

            const snapFilter = { featureType: layer.getSnapFeatureType() }
            const snapFeatures = getFeaturesByPropertyFromLayer(snapLayer, snapFilter)
            const snapFeature = findFeaturesToFeature(snapFeatures, snappedProperties)
            const { startPosition } = getFromToCoordinates(modifiedFeature)
            const offset = getOffsetOnFeature(snapFeature, startPosition)
            const [ lng, lat ] = toLonLat(startPosition)
            const mergedSnapProps = {
                lng,
                lat,
                offset,
                ...snappedProperties
            }
            let dto;
            if(typeof layer.recordToDto === "function") {
                dto = layer.snapPropertiesToDto(mergedSnapProps, layer.recordToDto(modifiedFeature.getProperties()))
            } else {
                console.error("properties를 json 형식으로 변환해주는 메서드 생성 필요")
                {
                    dto = {
                        mergedSnapProps,
                        ...modifiedFeature.getProperties()
                    }
                }
            }


            console.log("modified dto:::", dto)
            store.getState().updateCurrentJsonData(dto);
        }

        const selectedFeatures = getFeaturesByIdsFromLayer(layer, selectedGuid)
        const options = {
            olLayer: layer,
            features: selectedFeatures,
        };

        if (isEditable) {
            olEventManager.bind("modifyend", onModifyEnd, options);
        } else {
            olEventManager.unbind("modifyend", onModifyEnd);
        }

        return () => {
            olEventManager.unbind("modifyend", onModifyEnd);
        };
    }, [ isEditable, submenu.menuCode ]);

    useEffect(() => {
        if (!olEventManager || !submenu.menuCode || !map) return;
        const onSelect = (e: SelectEvent) => {
            selectInteractionRef.current = e.target
            const features: Collection<Feature> = e.target.getFeatures()
            console.log("selected features:::", features)
            const selectedIds = getValuesFromFeatures(features, "__guid")
            setSelectedGuid(selectedIds)
        };

        const options = {
            olLayers: layers,
        }
        if (layer) olEventManager.bind("select", onSelect, options)
        return () => {
            if (layer) olEventManager.unbind("select", onSelect)
        };
    }, [ submenu.menuCode ]);

    useEffect(() => {
        console.log("drawGeometryType:::", drawGeometryType)
    }, [ drawGeometryType ]);

    const handleCheck = () => {
        console.log("체크한 row:", gridRef.current?.getSelectedRow());
        console.log("그리드 업데이트 확인:", gridRef.current?.isGridChanged());
        console.log("changed?", gridRef.current?.getChangedValue())
        console.log("currentGeojson:", store.getState().currentGeojson) // 디버깅용
        console.log("current originData:", useBusStationStore.getState().originData) // 디버깅용
        console.log("current currentJsonData:", useBusStationStore.getState().currentJsonData) // 디버깅용
        console.log("current layer:", layer) // 디버깅용
        console.log("current source:", layer.getSource().getFeatures()) // 디버깅용
        console.log("current selectId:", useSelectionStore.getState().selectedGuid) // 디버깅용
        console.log("current feature:::", filterFeaturesByIds(layer.getSource().getFeatures(), selectedGuid))
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
        // const baseData = addedData?.baseData ?? {};
        // addRow({ baseData });
    }
    const handleDrawBtn = () => {
        setIsDrawing(true);
        const menuMeta = menuDrawRequirements[submenu.menuCode];
        if (!menuMeta?.requiresType) {
            setIsDrawing(true);
            return;
        } else {
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
        useBusStationStore.getState().removeRecordsByGuid(selectedGuid);
        // deleteSelected()
    }

    const handleSaveBtn = async () => {
        const api = apiConfig[submenu.menuCode as ApiMenuKey].update;
        const geojson = store.getState().currentGeojson;
        const logJson = historyStore.getState().updateLogs;
        const payload = {
            versionId: 1,
            geojson,
            logJson
        };
        try {
            await axiosInstance({
                method: api.method,
                url: api.url,
                data: payload,
            });

            console.log("저장 완료:",);
            alert("저장 완료")
        } catch (error) {
            console.error("저장 실패:", error);
            alert("저장 실패")
        }
        historyStore.getState().resetAllUpdates();
    }

    const handleEditableBtn = () => {
        setIsEditable(!isEditable);
        // switchEditable(!isEditable);
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

        const mergeGeojson = mergeGeojsonWithLog(store, updateHistory, isUndo);

        const format = new GeoJSON();
        const features = format.readFeatures(mergeGeojson, {
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
                                value={ drawGeometryType ?? '' }
                                onChange={ (e) => setDrawGeometryType(e.target.value as GeometryType) }
                            >
                                { geometryTypeOptions.map(type => (
                                    <option key={ type } value={ type }>{ type }</option>
                                )) }
                            </select>
                            <button className="add-btn" onClick={ () => handleAddBtn() }>추가</button>
                            <button className="add-btn"
                                    onClick={ () => handleDrawBtn() }>{ isDrawing ? "그리기 취소" : "그리기" }</button>
                            <button className="delete-btn" onClick={ () => handleDeleteBtn() }>삭제</button>
                            <button className="save-btn" onClick={ () => handleSaveBtn() }>저장</button>
                            <button className="save-btn" onClick={ () => handleInitBtn() }>되돌리기</button>
                            <HistoryController onHistoryAply={ handleHistoryApply }></HistoryController>
                            <button className="edit-btn"
                                    onClick={ () => handleEditableBtn() }>{ isEditable ? "편집 중지" : "편집 활성화" }</button>
                            <button onClick={ () => handleCheck() }>Interaction 객체 목록 디버깅</button>
                            <button className="btn" onClick={ () => handleShowHistory() }>변경 이력 보기</button>
                        </div>
                        <button className="close-btn" onClick={ onClose }>×</button>
                    </div>
                    <div className="popup-body">
                        { isTypeSelect && (
                            <TypeSelectionModal typeKey={ submenu.menuCode } onConfirm={ (selectedType) => {
                                onConfirm?.(selectedType);
                                setIsTypeSelect(false);
                            } } onCancel={ () => setIsTypeSelect(false) }/>
                        ) }
                        { isHistoryOpen && (
                            <HistoryModal
                                onClose={ () => setIsHistoryOpen(false) }
                                open={ isHistoryOpen }
                                //onApply={handleApplyHistory}
                                //historySteps={fakeHistorySteps}
                                //originFeatures={originFeatures}
                                menuCode={ activeSubmenu.menuCode }
                            />
                        ) }
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
                                { Object.entries(currentJsonData).map(([ key, value ]) => (
                                    Array.isArray(value) && value.length > 0 && (
                                        <div key={ key } className="grid-container">
                                            <div className="grid-header">
                                                <h4>
                                                    { key.charAt(0).toUpperCase() + key.slice(1) }
                                                </h4>
                                                <FontAwesomeIcon onClick={ () => toggleGrid(key) }
                                                                 icon={ expandedKey === key ? faChevronUp : faChevronDown }/>
                                            </div>
                                            { expandedKey === key && submenu.item.layer && (
                                                <JsonGrid rowData={ value } levelName={ key }
                                                          layerName={ submenu.item.layer }
                                                          layerGroupName={ "facility" }
                                                          editable={ isEditable }
                                                />
                                            ) }
                                        </div>
                                    )
                                )) }
                            </div>
                        }
                    </div>
                </div>
            </div>

        </>
    );
};

export default PropertyPanel;