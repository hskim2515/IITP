import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import "/static/css/styles.css";
import {MenuTree} from "@stores/useMenuStore";
import {propertyFormSchema} from "../form/propertyFormSchema";
import {buildColumnDefs, featureCollectionToFlatRow,} from "@utils/grid";
import {ColDef} from "ag-grid-community";
import {GridHandle} from "@type/GirdOptions";
import {menuCodeToStoreMap} from "@hooks/useLayerInit";
import {useEventStore} from "@stores/useEventStore";
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import useGrid, {AddOptions} from "@hooks/useGrid";
import GeometryType from "@type/FeatureOptions";
import {SelectEvent} from "ol/interaction/Select";
import {Feature} from "ol";
import VectorLayer from "ol/layer/Vector";
import BaseLayer from "ol/layer/Base";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import {ModifyEvent} from "ol/interaction/Modify";
import {DrawEvent} from "ol/interaction/Draw";
import {apiConfig, ApiMenuKey} from "../../config/apiConfig";
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
import {useScenarioStore} from "@stores/useScenarioStore";
import {useSelectionStore} from "@stores/useSelectionStore";
import {Select} from "ol/interaction";
import {
    convertFeatureToRecord,
    createFeature,
    filterFeaturesByKey, getFeaturesByProperties,
    getFromToCoordinates, getSnapFeature,
    getValuesFromFeatures
} from "@utils/feature";
import {generateGUIDWithType} from "@utils/guid";
import Collection from "ol/Collection";
import {faClose} from "@fortawesome/free-solid-svg-icons/faClose";
import VectorSource from "ol/source/Vector";

export interface PropertyPanelProps {
    activeSubmenu: MenuTree
    onClose: () => void;
}

const geometryTypeOptions: GeometryType[] = [
    GeometryType.POINT,
    GeometryType.LINE_STRING,
    GeometryType.POLYGON,
];
const PropertyPanel = ({activeSubmenu, onClose}: PropertyPanelProps) => {
    const submenu = {
        menuCode: activeSubmenu.menuCode,
        item: propertyFormSchema[activeSubmenu.menuCode],
        title: activeSubmenu.nameKor
    }
    const gridRef = useRef<GridHandle>(null)
    const [rowData, setRowData] = useState<Record<string, unknown>[]>([])
    const [colDefs, setColDefs] = useState<ColDef[] | undefined>(undefined)

    // 동적 스토어
    const store = menuCodeToStoreMap[submenu.menuCode];
    const selectedGuid = useSelectionStore((state) => state.selectedGuid)
    const setSelectedGuid = useSelectionStore((state) => state.setSelectedGuid)
    const addSelectionId = useSelectionStore((state) => state.addSelectionId)
    const clearSelected = useSelectionStore((state) => state.clearSelected)
    const removeSelectionId = useSelectionStore((state) => state.removeSelectionId)
    const selectedGuidRef = useRef<[]>([])
    const historyStore = menuCodeToHistoryStoreMap[submenu.menuCode];

    const [currentJsonData, setCurrentJsonData] = useState(store.getState().currentJsonData);

    const olEventManager = useEventStore.getState().olEventManager;
    const [drawGeometryType, setDrawGeometryType] = useState<GeometryType>(GeometryType.POINT)

    const [isDrawing, setIsDrawing] = useState<boolean>(false)
    const [isTypeSelect, setIsTypeSelect] = useState(false);
    const [onConfirm, setOnConfirm] = useState<((selected: string) => void) | null>(null);

    const [expandedKey, setExpandedKey] = useState<string | null>(null);

    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [selectedType, setSelectedType] = useState<string|undefined>(undefined)

    const selectedScenario = useScenarioStore.getState().selectedScenario;

    const olMap = useOpenLayersStore.state.map()

    const [isMinimized, setIsMinimized] = useState(false);



    useEffect(() => {
        const unsubscribe = store.subscribe(
            (state) => state.currentJsonData,
            (newJsonData) => {
                setCurrentJsonData(newJsonData); // 갱신 트리거
            }
        );
        return () => unsubscribe();
    }, []);

    const layer = useMemo(() => {
        return olMap?.getLayers().getArray()
            .find((layer: VectorLayer | BaseLayer | WebGLVectorLayer) => layer["layer"] === submenu.item?.layer);
    }, [olMap, submenu.menuCode]);

    useEffect(() => {
        if (!selectedGuidRef || !layer) return;

        const prevGuids: [] = selectedGuidRef.current;
        const nextGuids: [] = selectedGuid;

        function shallowEqualArray<T>(a: T[], b: T[]): boolean {
            if (a.length !== b.length) return false;
            return a.every((val, i) => val === b[i]);
        }

        if (shallowEqualArray(prevGuids, nextGuids)) return;

        const allFeatures = layer.getSource().getFeatures();
        const deselected = prevGuids.filter((id) => !nextGuids.includes(id));
        const deselectedFeatures = filterFeaturesByKey(allFeatures, deselected);

        deselectedFeatures.forEach((f) => {
            if (typeof layer.getDefaultStyle !== "function") return;
            f.setStyle(layer.getDefaultStyle())
        });

        const newlySelected = nextGuids.filter((id) => !prevGuids.includes(id));
        const selectedFeatures = filterFeaturesByKey(allFeatures, newlySelected);
        selectedFeatures.forEach((f) => {
            if (typeof layer.getSelectStyle !== "function") return;
            f.setStyle(layer.getSelectStyle())
        });

        // 상태 갱신
        selectedGuidRef.current = nextGuids;
    }, [selectedGuid]);

    const snapLayer = useMemo(() => {
        return olMap?.getLayers().getArray()
            .find((targetLayer: VectorLayer | BaseLayer | WebGLVectorLayer) => {
                if(typeof layer.getSnapLayerKey!=="function") {
                    return targetLayer["layer"] === "network"
                } else
                    return targetLayer["layer"] === layer.getSnapLayerKey()
                }
            );
    }, [olMap, submenu.menuCode, layer]);

    const toggleGrid = (key: string) => {
        setExpandedKey((prevKey) => (prevKey === key ? null : key)); // 같은 key면 닫기
    };

    const layers = useMemo(() => {
        return olMap?.getLayers().getArray()
            .filter((layer: VectorLayer | BaseLayer | WebGLVectorLayer) => layer["layerGroup"] === "facility");
    }, [olMap, submenu.menuCode]);
    const selectedTypeRef = useRef<string | undefined>(undefined);

    useEffect(() => {
        selectedTypeRef.current = selectedType;
    }, [selectedType]);
    useEffect(() => {
        clearSelected()
    }, [activeSubmenu]);

    const [reloadFlag, setReloadFlag] = useState(false);

    useHistoryInit(reloadFlag);

    const {
        addRow,
        deleteSelected,
        saveModifiedFeatures,
        updateFeatureByRow,
        switchEditable
    } = useGrid(gridRef, store, historyStore, colDefs)

    useEffect(() => {
        if (!olEventManager || !submenu.menuCode || !olMap || !layer ) return;

        const onDrawEnd = (e: DrawEvent) => {
            setIsDrawing(false);

            const id = Date.now();
            const requiresType = menuDrawRequirements[submenu.menuCode]?.requiresType ?? false;

            const featureType = requiresType
                ? selectedTypeRef.current ?? ''
                : (typeof layer.getFeatureType === 'function' ? layer.getFeatureType() ?? '' : '');

            if (!featureType) {
                console.warn('featureType이 비어 있습니다. selectedType과 getFeatureType 모두 undefined');
            }
            const guid = generateGUIDWithType(featureType);
            e.feature.setProperties({
                id,
                __guid: guid
            });

            // selection id 설정
            const drewProperties = e.feature.getProperties();
            const {fromCoord} = getFromToCoordinates(e.feature);

            addSelectionId([drewProperties["__guid"]]);

            // snap
            const maxDistance = 10
            const snapTargetFeatures = getFeaturesByProperties(snapLayer, {featureType: layer.getSnapFeatureType()})
            const snapFeature = getSnapFeature(snapTargetFeatures, fromCoord, maxDistance)
            if (typeof layer.recordToSnapProperties !== "function") {
                console.warn("레이어 내부에 공통 메서드 recordToSnapProperties 작성 필요 ")
            }

            const snapProperties = snapFeature
                ? layer.recordToSnapProperties(snapFeature.getProperties(), featureType)
                : undefined;
            // metadata 생성 (offset 포함)
            const metadata = layer.computeMetadata(snapFeature, snapProperties, fromCoord);

            const dto = layer.snapPropertiesToDto(metadata, layer.recordToDto(drewProperties, featureType));
            store.getState().updateCurrentJsonData(dto, historyStore);
        };

        const options = {drawGeometryType};
        if (isDrawing) {
            olEventManager.bind("drawend", onDrawEnd, options);
        }
        return () => {
            olEventManager.unbind("drawend", onDrawEnd);
        };
    }, [isDrawing, layer]);

    useEffect(() => {
        if (!olEventManager || !layer) return;

        const onModifyEnd = (e: ModifyEvent) => {

            const features: Collection<Feature> = e.features;
            const modifiedIds = getValuesFromFeatures(features, "__guid")
            const modifiedFeature = e.features.getArray()[0]
            setSelectedGuid(modifiedIds)
            const {fromCoord} = getFromToCoordinates(modifiedFeature)
            if (typeof layer.recordToSnapProperties !== "function") {
                console.error("레이어 내부에 공통 메서드 recordToSnapProperties 작성 필요 ")
                return
            }
            // snap
            const maxDistance = 10
            const snapTargetFeatures = getFeaturesByProperties(snapLayer, {featureType: layer.getSnapFeatureType()})
            const snapFeature = getSnapFeature(snapTargetFeatures, fromCoord, maxDistance)

            const featureType = modifiedFeature.get("featureType")

            if (!featureType) {
                console.warn('featureType이 비어 있습니다.');
            }
            const snapProperties = snapFeature
                ? layer.recordToSnapProperties(snapFeature.getProperties(), featureType)
                : undefined;

            const metadata = layer.computeMetadata(snapFeature, snapProperties, fromCoord)

            const modifiedRecord = layer.recordToDto(modifiedFeature.getProperties(), featureType)
            const dto = layer.snapPropertiesToDto(metadata, modifiedRecord)
            store.getState().updateCurrentJsonData(dto, historyStore);
        }

        const selectedFeatures = filterFeaturesByKey(layer, selectedGuid)
        const options = {
            features: selectedFeatures,
        };


            olEventManager.bind("modifyend", onModifyEnd, options);

        return () => {
            olEventManager.unbind("modifyend", onModifyEnd);
        };
    }, [layer, selectedGuid, selectedTypeRef.current]);

    //select
    useEffect(() => {
        if (!olEventManager || !layer) return;
        const onSelect = (e: SelectEvent) => {
            const features: Collection<Feature> = e.target.getFeatures()
            const selectedIds = getValuesFromFeatures(features, "__guid")
            setSelectedGuid(selectedIds)
        };
        const options = {
            olLayers: [layer],
            // style: layer.getInteractionStyle("select")
        }
        if (layer) olEventManager.bind("select", onSelect, options)
        return () => {
            if (layer) olEventManager.unbind("select", onSelect)
        };
    }, [olEventManager, layer]);

    //snap
    useEffect(() => {
        if (!olEventManager || !snapLayer || !layer) return
        const onSnap = (e: any) => {
        };

        const features:Feature[] = snapLayer.getSource().getFeatures()

        if(typeof layer.getSnapFeatureType !== "function") {
            const featureCollection = new Collection<Feature>(features)
            console.error("getSnapFeatureType 이 없음")
            const options = {
                features: featureCollection
            };

            olEventManager.bind("snap", onSnap, options);
        } else {
            const featureCollection = getFeaturesByProperties(features, {featureType: layer.getSnapFeatureType()})

            const options = {
                features: featureCollection
            };

            olEventManager.bind("snap", onSnap, options);
        }


        return () => {
            olEventManager.unbind("snap", onSnap);
        };
    }, [isDrawing, snapLayer, selectedGuid, layer]);

    const handleCheck = () => {
        console.log("체크한 row:", gridRef.current?.getSelectedRow());
        console.log("그리드 업데이트 확인:", gridRef.current?.isGridChanged());
        console.log("changed?", gridRef.current?.getChangedValue())
        console.log("currentGeojson:", store.getState().currentGeojson) // 디버깅용
        console.log("currentGeojson:", store.getState().currentGeojson) // 디버깅용
        console.log("current originData:", store.getState().originData) // 디버깅용
        console.log("current currentJsonData:", store.getState().currentJsonData) // 디버깅용
        console.log("current layer:", layer) // 디버깅용
        console.log("current source:", layer.getSource().getFeatures()) // 디버깅용
        console.log("current selectId:", useSelectionStore.getState().selectedGuid) // 디버깅용
        console.log("current feature:::", filterFeaturesByKey(layer.getSource().getFeatures(), selectedGuid))
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

    }, [submenu.menuCode]);


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

    const handleDrawBtn = () => {
        if (isDrawing) {
            setIsDrawing(false)
            return;
        }
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
        store.getState().removeRecordsByGuid(selectedGuid, historyStore)
        deleteSelected()
    }

    const handleSaveBtn = async () => {
        const api = apiConfig[submenu.menuCode as ApiMenuKey].update;
        const currentJson = store.getState().currentJsonData;
        const logJson = historyStore.getState().updateLogs;
        if (!logJson) {
            alert('변경사항이 없습니다.');
            return
        }
        const mergedLog = mergeUpdateLogs(logJson);
        const extractedArray = Object.values(currentJson)[0];
        const payload = {
            //timestamp: new Date().toISOString(),
            data:extractedArray,
            logs: mergedLog,
        };
        try {
            await axiosInstance({
                method: api.method,
                url: api.url + '/' + selectedScenario.key,
                data: payload,
            });

            historyStore.getState().resetAllUpdates();
            setReloadFlag(prev => !prev);
            alert("저장 완료")
        } catch (error) {
            console.error("저장 실패:", error);
            alert("저장 실패")
        }
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

        const currentJsonData = store.getState().currentJsonData;
        const firstKey = Object.keys(currentJsonData)[0] as keyof typeof currentJsonData;
        const currentJsonItem = currentJsonData[firstKey];
        const featuresMap = new Map<string | number, Feature>();
        const featureData = currentJsonItem.map((data) => createFeature(data));

        featureData.forEach((feature) => {
            if (!feature) return;
            const id = feature.get('id');
            if (id != null) {
                featuresMap.set(id, feature);
            }
        });

        const mergeFeature = mergeJsonWithLog(featuresMap, updateHistory.json, isUndo);
        const interpolated = interpolateByOffset(mergeFeature);
        const flatRows = interpolated
            .map(f => convertFeatureToRecord(f))
            .filter(r => r.id !== undefined && !isNaN(Number(r.id)))
            .sort((a, b) => Number(a.id) - Number(b.id));

        // store.getState().setCurrentJsonData({
        //     pavementMarkings: flatRows,
        // });

        alert(isUndo ? "Undo 성공" : "Redo 성공");
    };

    return (
        <>
            <div className={`popup-overlay${submenu.item.type ? `-${submenu.item.type}` : ''}`}>
                <div className={`popup-container${submenu.item.type ? `-${submenu.item.type}` : ''}`}>
                    <div className="popup-header">
                        <span>{submenu.title}</span>
                        <div className="popup-header-actions">
                            <button className="add-btn" onClick={() => handleDrawBtn()}>그리기</button>
                            <button className="delete-btn" onClick={() => handleDeleteBtn()}>지우기</button>
                            <button className="save-btn" onClick={() => handleSaveBtn()}>저장</button>
                            <button className="save-btn" onClick={() => handleInitBtn()}>되돌리기</button>
                            <HistoryController onHistoryAply={handleHistoryApply}></HistoryController>
                            <button onClick={() => handleCheck()}>Interaction 객체 목록 디버깅</button>
                            <button className="btn" onClick={() => handleShowHistory()}>변경 이력 보기</button>
                        </div>
                        <FontAwesomeIcon className="minimize-btn"
                                         icon={isMinimized ? faChevronUp : faChevronDown}
                                         onClick={() => setIsMinimized(!isMinimized)}
                        />
                        <FontAwesomeIcon className="close-btn" icon={faClose} onClick={onClose}/>
                    </div>
                    {!isMinimized && (
                        <div className="popup-body">
                            {isTypeSelect && (
                                <TypeSelectionModal typeKey={submenu.menuCode} onConfirm={(selectedType) => {
                                    onConfirm?.(selectedType);
                                    setIsTypeSelect(false);
                                }} onCancel={() => {
                                    setIsTypeSelect(false)
                                    setIsDrawing(false)
                                }}/>
                            )}
                            {isHistoryOpen && (
                                <HistoryModal
                                    onClose={() => setIsHistoryOpen(false)}
                                    open={isHistoryOpen}
                                    menuCode={activeSubmenu.menuCode}
                                />
                            )}
                            {submenu.item &&
                                //{ submenu.item && colDefs &&
                                // <Grid
                                //     ref={ gridRef }
                                //     colDefs={ colDefs }
                                //     rowData={ rowData }
                                //     onCellValueChanged={ updateFeatureByRow }
                                //     onSelectionChanged={ handleGridSelectionChanged }
                                // />
                                <div>
                                    {Object.entries(currentJsonData).map(([key, value]) => (
                                        Array.isArray(value) && value.length > 0 && (
                                            <div key={key} className="grid-container">
                                                <div className="grid-header">
                                                    <h4 style={{margin: 12}}>
                                                        {key.charAt(0).toUpperCase() + key.slice(1)}
                                                    </h4>
                                                    <FontAwesomeIcon onClick={() => toggleGrid(key)}
                                                                     icon={expandedKey === key ? faChevronUp : faChevronDown}/>
                                                </div>
                                                {expandedKey === key && (
                                                    <JsonGrid rowData={value} levelName={key}
                                                              layerName={submenu.item.layer}
                                                              layerGroupName={"facility"}
                                                    />
                                                )}
                                            </div>
                                        )
                                    ))}
                                </div>
                            }
                        </div>
                    )}
                </div>
            </div>

        </>
    );
};

export default PropertyPanel;