import React, {useEffect, useMemo, useRef, useState} from 'react';
import "/static/css/styles.css";
import {MenuTree} from "@stores/useMenuStore";
import {propertyFormSchema} from "@component/form/propertyFormSchema";
import {menuCodeToStoreMap} from "@hooks/useLayerInit";
import {useEventStore} from "@stores/useEventStore";
import {useOpenLayersStore} from "@stores/useOpenLayersStore";
import GeometryType from "@type/FeatureOptions";
import {Feature} from "ol";
import VectorLayer from "ol/layer/Vector";
import BaseLayer from "ol/layer/Base";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import {ModifyEvent} from "ol/interaction/Modify";
import {DrawEvent} from "ol/interaction/Draw";
import {apiConfig, ApiMenuKey} from "@config/apiConfig";
import axiosInstance from "@api/axiosInstance";
import JsonGrid from "@component/util/JsonGrid";
import {
    faChevronDown,
    faChevronUp,
} from "@fortawesome/free-solid-svg-icons";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import useHistoryInit, {menuCodeToHistoryStoreMap} from "@hooks/useHistoryInit";
import {mergeJsonWithLog, mergeUpdateLogs} from "@utils/history";
import HistoryController from "@component/modal/HistoryController";
import {menuDrawRequirements} from "@config/menuDrawConfig";
import TypeSelectionModal from "@component/modal/TypeSelectionModal";
import HistoryModal from "@component/modal/HistoryModal";
import {useScenarioStore} from "@stores/useScenarioStore";
import {useSelectionStore} from "@stores/useSelectionStore";
import {
    filterFeaturesByKey, getFeaturesByProperties,
    getFromToCoordinates, getSnapFeature,
    getValuesFromFeatures
} from "@utils/feature";
import {generateGUIDWithType} from "@utils/guid";
import Collection from "ol/Collection";
import {faClose} from "@fortawesome/free-solid-svg-icons/faClose";
import deepEqual from "deep-equal";
import { FeatureLayerAPI, isFeatureLayer } from "@features/FeatureLayerAPI";
import { matchesCustomKeyValue } from "@utils/olLayer";
import {useSchemeStore} from "@stores/useSchemeStore";

export interface PropertyPanelProps {
    activeSubmenu: MenuTree
    onClose: () => void;
}

const PropertyPanel = ({activeSubmenu, onClose}: PropertyPanelProps) => {
    const submenu = {
        menuCode: activeSubmenu.menuCode,
        item: propertyFormSchema[activeSubmenu.menuCode],
        title: activeSubmenu.nameKor
    }

    // 동적 스토어
    const store = menuCodeToStoreMap[submenu.menuCode];
    const selectedGuid = useSelectionStore((state) => state.selectedGuid)
    const setSelectedGuid = useSelectionStore((state) => state.setSelectedGuid)
    const addSelectionId = useSelectionStore((state) => state.addSelectionId)
    const clearSelected = useSelectionStore((state) => state.clearSelected)
    const selectedGuidRef = useRef<(string | number)[]>([])
    const historyStore = menuCodeToHistoryStoreMap[submenu.menuCode];

    const [currentJsonData, setCurrentJsonData] = useState(store.getState().currentJsonData);

    const olEventManager = useEventStore.getState().olEventManager;
    const [drawGeometryType, setDrawGeometryType] = useState<GeometryType>(GeometryType.POINT)

    const [isDrawing, setIsDrawing] = useState<boolean>(false)
    const [isTypeSelect, setIsTypeSelect] = useState(false);
    const [onConfirm, setOnConfirm] = useState<((selected: string) => void) | null>(null);

    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const selectedDrawTypeRef = useRef<string | undefined>();

    const selectedScenario = useScenarioStore.getState().selectedScenario;

    const olMap = useOpenLayersStore.state.map()

    type BodySize = "mini" | "default" | "full";
    const [bodySize, setBodySize] = useState<BodySize>("default");

    useEffect(() => {
        const unsubscribe = store.subscribe(
            (state) => state.currentJsonData,
            (newJsonData) => {
                setCurrentJsonData(newJsonData); // 갱신 트리거
            }
        );

        fetch(process.env.VITE_API_URL + "/schemes/" + submenu.item.layer, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
        }).then((response) => {
            return response.json();
        })
        .then((data) => {
            useSchemeStore.getState().setSchemes(data);
        })

        return () => unsubscribe();
    }, []);

    const layer = useMemo<FeatureLayerAPI & VectorLayer | undefined>(() => {
        const foundLayer = olMap?.getLayers().getArray()
            .find(layer => matchesCustomKeyValue(layer, 'layer', submenu.item.layer))

            console.log("foundLayer:::", foundLayer)
        if (foundLayer && isFeatureLayer(foundLayer)) {
            console.log("foundLayer:::", foundLayer)
            return foundLayer;
        }
        return undefined;
    }, [olMap, submenu.menuCode]);


    useEffect(() => {
        if (!selectedGuidRef || !layer) return;

        const prevGuids: (string | number)[] = selectedGuidRef.current;
        const nextGuids: (string | number)[] = selectedGuid;

        if (deepEqual(prevGuids, nextGuids)) return;
        const source = layer.getSource();
        if(!source) return;
        const allFeatures = source.getFeatures();
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
        if(!layer) return;
        return olMap?.getLayers().getArray()
            .find((targetLayer): targetLayer is VectorLayer => {
                if(typeof layer.getSnapLayerKey!=="function") {
                    return matchesCustomKeyValue(targetLayer, 'layer', 'network')
                } else
                    return matchesCustomKeyValue(targetLayer, 'layer', layer.getSnapLayerKey())
                }
            );
    }, [olMap, submenu.menuCode, layer]);

    const layers = useMemo(() => {
        return olMap?.getLayers().getArray()
            .filter((layer: VectorLayer | BaseLayer | WebGLVectorLayer) => matchesCustomKeyValue(layer, 'layerGroup', 'facility'))
    }, [olMap, submenu.menuCode]);

    useEffect(() => {
        clearSelected()
    }, [activeSubmenu]);

    const [reloadFlag, setReloadFlag] = useState(false);

    useHistoryInit(reloadFlag);

    useEffect(() => {
        if (!olEventManager || !submenu.menuCode || !olMap || !layer ) return;

        const onDrawEnd = (e: DrawEvent) => {
            setIsDrawing(false);

            const id = Date.now();
            const requiresType = menuDrawRequirements[submenu.menuCode]?.requiresType ?? false;

            const featureType = requiresType
                ? selectedDrawTypeRef.current ?? ''
                : (typeof layer.getFeatureType === 'function' ? layer.getFeatureType() ?? '' : '');

            if (!featureType) {
                console.warn('featureType이 비어 있습니다. selectedDrawTypeRef getFeatureType 모두 undefined');
            }
            const guid = generateGUIDWithType(featureType);
            e.feature.setProperties({
                id,
                __guid: guid
            });

            // selection id 설정
            const drewProperties = e.feature.getProperties();
            const {fromCoord} = getFromToCoordinates(e.feature);

            addSelectionId(drewProperties["__guid"]);

            // snap
            const maxDistance = 10
            const snapTargetFeatures = getFeaturesByProperties(snapLayer, {featureType: layer.getSnapFeatureType()})
            const snapFeature = getSnapFeature(snapTargetFeatures, fromCoord, maxDistance)
            if (typeof layer.recordToSnapProperties !== "function") {
                console.warn("레이어 내부에 공통 메서드 recordToSnapProperties 작성 필요 ")
            }
            const snapProperties = snapFeature
                ? layer.recordToSnapProperties(snapFeature.getProperties())
                : undefined;
            if(!fromCoord) return
            // metadata 생성 (offset 포함)
            const metadata = layer.computeMetadata(snapFeature, snapProperties, fromCoord, selectedDrawTypeRef.current);

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
            setSelectedGuid(modifiedIds)

            const modifiedFeature = e.features.getArray()[0]
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
            console.log("modify snappedProperties dto:::", dto)
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
    }, [layer, selectedGuid, selectedDrawTypeRef.current]);

    //snap
    useEffect(() => {
        if (!olEventManager || !snapLayer || !layer) return
        const onSnap = (e: any) => {
        };
        const source = snapLayer.getSource();
        if(!source) return;
        const features:Feature[] = source.getFeatures()

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
            if(!options) return
            olEventManager.bind("snap", onSnap, options);
        }


        return () => {
            olEventManager.unbind("snap", onSnap);
        };
    }, [isDrawing, snapLayer, selectedGuid, layer]);

    const handleCheck = () => {
        if (!layer) return
        const source = layer.getSource();
        if(!source) return;
        console.log("current originData:", store.getState().originData) // 디버깅용
        console.log("current currentJsonData:", store.getState().currentJsonData) // 디버깅용
        console.log("current layer:", layer) // 디버깅용
        console.log("current source:", source.getFeatures()) // 디버깅용
        console.log("current selectId:", useSelectionStore.getState().selectedGuid) // 디버깅용
        console.log("current feature:::", filterFeaturesByKey(source.getFeatures(), selectedGuid))
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
                selectedDrawTypeRef.current = type;
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
            console.log("저장 완료:",);
            alert("저장 완료")
        } catch (error) {
            console.error("저장 실패:", error);
            alert("저장 실패")
        }
    }

    const handleInitBtn = () => {
        store.getState().initCurrentData()
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
        const featuresMap = new Map<string | number, any>();
        currentJsonItem.forEach((data) => {
            const id = data.__guid;
            if (id != null) {
                featuresMap.set(id, JSON.parse(JSON.stringify(data)));
            }
        });
        const mergeJsonData = mergeJsonWithLog(featuresMap, updateHistory.json, isUndo);
        store.getState().setCurrentJsonData({
            ...currentJsonData,
            [firstKey]: mergeJsonData,
        });

        alert(isUndo ? "Undo 성공" : "Redo 성공");

    };

    const increaseSize = () => {
        setBodySize(prev => {
            if (prev === "mini") return "default";
            if (prev === "default") return "full";
            return "full"; // 이미 full이면 유지
        });
    };

    const decreaseSize = () => {
        setBodySize(prev => {
            if (prev === "full") return "default";
            if (prev === "default") return "mini";
            return "mini"; // 이미 mini면 유지
        });
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

                        <div>

                            <FontAwesomeIcon className="close-btn" icon={faClose} onClick={onClose}/>
                            {(bodySize !== "full") &&(<FontAwesomeIcon
                                className="expand-btn"
                                icon={faChevronUp} // ⬆️ 확대 아이콘
                                onClick={increaseSize}
                                title="확장"
                            />)}
                            {(bodySize !== "mini") &&(<FontAwesomeIcon
                                className="collapse-btn"
                                icon={faChevronDown} // ⬇️ 축소 아이콘
                                onClick={decreaseSize}
                                title="축소"
                            />)}

                        </div>

                    </div>

                    <div className={
                        bodySize === "full" ? "popup-body-full"
                            : bodySize === "mini" ? "popup-body-mini"
                                : "popup-body"
                    }>
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
                            <div style={{width:"99%"}}>
                                {Object.entries(currentJsonData).map(([key, value]) => (
                                    Array.isArray(value) && value.length > 0 && (
                                        <div key={key} className="grid-container">

                                            <JsonGrid rowData={value} levelName={key}
                                                      layerName={submenu.item.layer}
                                                      layerGroupName={"facility"}
                                            />
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