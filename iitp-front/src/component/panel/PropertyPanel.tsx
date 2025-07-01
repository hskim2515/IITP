import React, { useEffect, useMemo, useRef, useState } from 'react';
import "/static/css/styles.css";
import { MenuTree } from "@stores/useMenuStore";
import { propertyFormSchema } from "../form/propertyFormSchema";
import { menuCodeToStoreMap } from "@hooks/useLayerInit";
import { useEventStore } from "@stores/useEventStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";

import GeometryType from "@type/FeatureOptions";

import { Feature } from "ol";
import VectorLayer from "ol/layer/Vector";
import BaseLayer from "ol/layer/Base";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import { ModifyEvent } from "ol/interaction/Modify";
import { DrawEvent } from "ol/interaction/Draw";
import { apiConfig, ApiMenuKey } from "../../config/apiConfig";
import axiosInstance from "../../api/axiosInstance";
import JsonGrid from "../util/JsonGrid";
import { faChevronDown, faChevronUp } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useSelectionStore } from "@stores/useSelectionStore";
import { SelectEvent } from "ol/interaction/Select";
import Collection from "ol/Collection";
import {
    filterFeaturesByIds,
    findFeaturesToFeature,
    getFeaturesByIdsFromLayer,
    getFeaturesByPropertyFromLayer,
    getFromToCoordinates,
    getOffsetOnFeature,
    getValuesFromFeatures
} from "@utils/feature";
import { toLonLat } from "ol/proj";
import { useBusStationStore } from "@stores/useBusStationStore";
import { generateTrafficTypesGUID } from "@utils/guid";
import { Select } from "ol/interaction";

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

    // 동적 스토어
    const store = menuCodeToStoreMap[submenu.menuCode];
    const selectedGuid = useSelectionStore((state) => state.selectedGuid)
    const setSelectedGuid = useSelectionStore((state) => state.setSelectedGuid)
    const addSelectionId = useSelectionStore((state) => state.addSelectionId)
    const clearSelected = useSelectionStore((state) => state.clearSelected)
    const removeSelectionId = useSelectionStore((state) => state.removeSelectionId)
    const selectedGuidRef = useRef<[]>([])

    const [currentJsonData, setCurrentJsonData] = useState(store.getState().currentJsonData);
    const initCurrentData = store.getState().initCurrentData;

    const olEventManager = useEventStore.getState().olEventManager;
    const [ drawGeometryType, setDrawGeometryType ] = useState<GeometryType>(GeometryType.POINT)

    const selectInteractionRef = useRef<Select | undefined>(undefined);
    const snappedPropertiesRef = useRef<Record<string, string | number | undefined>>(undefined);

    const [ isEditable, setIsEditable ] = useState<boolean>(false)
    const [ isDrawing, setIsDrawing ] = useState<boolean>(false)

    const [ expandedKey, setExpandedKey ] = useState<string | null>(null);

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
        deselectedFeatures.forEach((f) => f.setStyle(layer.getDefaultStyle()));

        // 선택 > 선택 스타일 적용
        const newlySelected = nextGuids.filter((id) => !prevGuids.includes(id));
        const selectedFeatures = filterFeaturesByIds(allFeatures, newlySelected);
        selectedFeatures.forEach((f) => f.setStyle(layer.getSelectStyle()));

        // 상태 갱신
        selectedGuidRef.current = nextGuids;
    }, [selectedGuid]);

    const snapLayer = useMemo(() => {
        return olMap?.getLayers().getArray()
            .find((targetLayer: VectorLayer | BaseLayer | WebGLVectorLayer) => {

                return targetLayer["layer"] === layer.getSnapLayerKey()
            });
    }, [ olMap, submenu.menuCode, layer ]);

    const toggleGrid = (key: string) => {
        setExpandedKey((prevKey) => (prevKey === key ? null : key)); // 같은 key면 닫기
    };

    const layers = useMemo(() => {
        return olMap?.getLayers().getArray()
            .filter((layer: VectorLayer | BaseLayer | WebGLVectorLayer) => layer["layerGroup"] === "facility");
    }, [ olMap, submenu.menuCode ]);

    useEffect(() => {
        clearSelected()
    }, [ activeSubmenu ]);

    //draw
    useEffect(() => {
        if (!olEventManager || !submenu.menuCode || !olMap || !layer) return;

        // snap 속성이 추가되지 않음. id  lat lnf offset, transitmode만 추가굄
        const onDrawEnd = (e: DrawEvent) => {
            setIsDrawing(false)
            // generateTrafficTypesGUID()
            const id = Date.now()
            const featureType = layer.getFeatureType() || 'feature';
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

            const dto = layer.snapPropertiesToDto(mergedSnapProps, layer.recordToDto(drewProperties))
            console.log("draw dto:::", dto)

            store.getState().updateCurrentJsonData(dto);
        }
        const options = {
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
    }, [ isDrawing, layer ]);

    //modify
    useEffect(() => {
        if (!olEventManager || !layer) return;

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

            const dto = layer.snapPropertiesToDto(mergedSnapProps, layer.recordToDto(modifiedFeature.getProperties()))
            console.log("modified dto:::", dto)
            store.getState().updateCurrentJsonData(dto);
        }

        const selectedFeatures = getFeaturesByIdsFromLayer(layer, selectedGuid)
        const options = {
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
    }, [ isEditable, layer, selectedGuid ]);

    // useRef 사용해서, 선택된 객체 확인.
    //select
    useEffect(() => {
        if (!olEventManager || !layer) return;
        const onSelect = (e: SelectEvent) => {
            selectInteractionRef.current = e.target
            const features: Collection<Feature> = e.target.getFeatures()
            console.log("selected features:::", features)
            const selectedIds = getValuesFromFeatures(features, "__guid")
            setSelectedGuid(selectedIds)
        };
        const options = {
            olLayers: [ layer ],
            // style: layer.getInteractionStyle("select")
        }
        if (layer) olEventManager.bind("select", onSelect, options)
        return () => {
            if (layer) olEventManager.unbind("select", onSelect)
        };
    }, [ olEventManager, layer ]);

    //snap
    useEffect(() => {
        if (!olEventManager) return
        const onSnap = (e: any) => {
            const record = e.feature.getProperties();
            if (typeof layer?.recordToSnapProperties === 'function') {
                const snapProperties = layer.recordToSnapProperties(record);
                snappedPropertiesRef.current = snapProperties;
                console.log("snapProperties:::", snapProperties)
            }
        };
        if (!snapLayer) return;

        const features = getFeaturesByPropertyFromLayer(snapLayer, { featureType:layer.getSnapFeatureType() })

        const options = {
            // olLayer: snapLayer,
            features
        };

        olEventManager.bind("snap", onSnap, options);

        return () => {
            olEventManager.unbind("snap", onSnap);
        };
    }, [ isDrawing, isEditable, snapLayer, selectedGuid ]);

    const handleCheck = () => {
        console.log("current originData:", useBusStationStore.getState().originData) // 디버깅용
        console.log("current currentJsonData:", useBusStationStore.getState().currentJsonData) // 디버깅용
        console.log("current layer:", layer) // 디버깅용
        console.log("current source:", layer.getSource().getFeatures()) // 디버깅용
        console.log("current selectId:", useSelectionStore.getState().selectedGuid) // 디버깅용
        console.log("current feature:::", filterFeaturesByIds(layer.getSource().getFeatures(), selectedGuid))
    };

    const handleAddBtn = () => {
        // const baseData = addedData?.baseData ?? {};
        // addRow({ baseData });
    }
    const handleDrawBtn = () => {
        setIsDrawing(true)
    }
    const handleDeleteBtn = () => {
        useBusStationStore.getState().removeRecordsByGuid(selectedGuid);
        // selectedGuid.map(guid => removeSelectionId(guid))
    }

    // 보완 필요
    const handleSaveBtn = async () => {
        const api = apiConfig[submenu.menuCode as ApiMenuKey].update;
        const json = store.getState().currentJsonData;
        const payload = {
            id: 2,
            name: "busStation",
            json,
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
    }

    const handleInitBtn = () => {
        initCurrentData()
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
                            <button className="add-btn" onClick={ () => handleDrawBtn() }>{ isDrawing ? "그리기 취소" : "그리기" }</button>
                            <button className="delete-btn" onClick={ () => handleDeleteBtn() }>삭제</button>
                            <button className="save-btn" onClick={ () => handleSaveBtn() }>저장</button>
                            <button className="save-btn" onClick={ () => handleInitBtn() }>되돌리기</button>
                            <button className="edit-btn" onClick={ () => handleEditableBtn() }>{ isEditable ? "편집 중지" : "편집 활성화" }</button>
                            <button onClick={ () => handleCheck() }>Interaction 객체 목록 디버깅</button>
                        </div>
                        <button className="close-btn" onClick={ onClose }>×</button>
                    </div>
                    <div className="popup-body">
                        { submenu.item &&
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
                                                          editable={isEditable}
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