import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import useGrid from "@hooks/useGrid";
import GeometryType from "@type/FeatureOptions";
import { SelectEvent } from "ol/interaction/Select";
import { Feature } from "ol";
import VectorLayer from "ol/layer/Vector";
import BaseLayer from "ol/layer/Base";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import { ModifyEvent } from "ol/interaction/Modify";
import { DrawEvent } from "ol/interaction/Draw";
import { apiConfig, ApiMenuKey } from "../../config/apiConfig";
import axiosInstance from "../../api/axiosInstance";
import { EventManager } from "@managers/EventManager";
import { mergeFeatureProperties } from "@utils/feature";
import { mergeGeoJSONFeatureIntoCollection, olFeatureToGeoJSONFeature } from "@utils/geojson";
import { Select } from "ol/interaction";
import useSelectionIdStore from "@stores/useSelectionIdStore";
import VectorSource from "ol/source/Vector";
import { getClickCoordinateFromGeometry, getClosestSegmentFromGeometry, getSignedOffsetMeters } from "@utils/offset";

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

    const selectInteractionRef = useRef<Select>();

    const selectionIds = useSelectionIdStore((state) => state.selectionId);

    const setSelectionId = useSelectionIdStore((state) => state.setSelectionId);
    const addSelectionId = useSelectionIdStore((state) => state.addSelectionId);
    const removeSelectionId = useSelectionIdStore((state) => state.removeSelectionId);
    const clearSelectionId = useSelectionIdStore((state) => state.clearSelectionId);

    const lastSnappedFeatureRef = useRef<Feature | null>(null);

    const [ isEditable, setIsEditable ] = useState<boolean>(false)
    const [ isDrawing, setIsDrawing ] = useState<boolean>(false)
    const [ drawGeometryType, setDrawGeometryType ] = useState<GeometryType>(GeometryType.POINT)

    const olMap = useOpenLayersStore.state.map()

    const networkLayer = useMemo(() => {
        return olMap?.getLayers().getArray()
            .find((layer: VectorLayer | BaseLayer | WebGLVectorLayer) => layer["LAYER_NAME"] === "NETWORK");
    }, [ olMap ]);

    const layer = useMemo(() => {
        return olMap?.getLayers().getArray()
            .find((layer: VectorLayer | BaseLayer | WebGLVectorLayer) => layer["LAYER_NAME"] === submenu.menuCode);
    }, [ olMap, submenu.menuCode ]);

    const {
        createRowFromOptions,
        deleteSelected,
        updateFeatureByRow,
        switchEditable
    } = useGrid(gridRef, store, colDefs)

    useEffect(() => {
        if (!olMap) return;

        const select = new Select({
            layers: [layer],
            multi: true,
        });

        olMap.addInteraction(select);
        selectInteractionRef.current = select;

        const onSelect = (e: SelectEvent) => {
            e.selected.forEach((feature) => {
                addSelectionId(feature.get("id"));
                gridRef.current?.setSelectRowsWithField("id", feature.get("id"), true);
            });

            e.deselected.forEach((feature) => {
                removeSelectionId(feature.get("id"));
                gridRef.current?.setSelectRowsWithField("id", feature.get("id"), false);
            });
        };

        select.on("select", onSelect);

        return () => {
            select.un("select", onSelect);
            olMap.removeInteraction(select);
        };
    }, [ olMap, layer ]);

    useEffect(() => {
        if (!selectInteractionRef.current || !layer) return;
        console.log("changed!", selectionIds)

        const selectedFeatures: Feature[] = [];

        [layer].forEach((layer) => { // select 적용할 layer 배열로 저장 (현재는 단일 레이어)
            const source = (layer as VectorLayer).getSource() as VectorSource;
            if (!source) return;

            selectionIds.forEach((id) => {
                const feature = source.getFeatures().find(f => f.get("id") === id);
                if (feature && !selectedFeatures.includes(feature)) {
                    selectedFeatures.push(feature);
                }
            });
        });

        selectInteractionRef.current.getFeatures().clear();
        selectInteractionRef.current.getFeatures().extend(selectedFeatures);
    }, [ selectionIds, layer ]);


    useEffect(() => {
        return () => clearSelectionId()
    }, [ submenu.menuCode ]);

    useEffect(() => {
        if (isEditable) switchEditable(true)
        return () => {
            switchEditable(false)
        }
    }, [ isEditable, switchEditable ]);

    useEffect(() => {
        if (!isDrawing) return;

        const onDrawEnd = (e: DrawEvent) => {
            setIsDrawing(false)
            const feature: Feature = e.feature;
            const drawGeometry = feature.getGeometry();
            const clickCoord = getClickCoordinateFromGeometry(drawGeometry);

            // snap된 geometry
            const snapFeature = lastSnappedFeatureRef.current;
            const snapGeometry = snapFeature?.getGeometry();
            if (!snapGeometry) return;

            // snapGeometry에서 가장 가까운 선분 추출
            const segment = getClosestSegmentFromGeometry(snapGeometry, clickCoord);
            if (!segment) return;

            // 시작점 기준으로 클릭좌표까지의 거리 계산 (m 단위)
            const offset = getSignedOffsetMeters(segment.from, segment.to, clickCoord);
            feature.set("offset", offset);

            const newId = Date.now()

            console.log("currentFeature draw with baseData:::", lastSnappedFeatureRef.current?.getProperties().properties)
            const mergedProperties = mergeFeatureProperties({
                baseFeatureProperties: lastSnappedFeatureRef.current?.getProperties().properties,
                newFeatureProperties: feature.getProperties()
            })
            console.log("mergedProperties:::", mergedProperties)
            // snap 데이터 -> feature 설정
            feature.setProperties({
                ...mergedProperties
            }, false) // id 설정 후에 feature 일괄 갱신
            feature.set("id", newId)
            console.log("mergedProperties feature:::", feature)
            const geojsonFeature = olFeatureToGeoJSONFeature(feature)

            const updated = mergeGeoJSONFeatureIntoCollection({
                feature: geojsonFeature,
                featureCollection: store.getState().currentGeojson!
            })
            store.getState().setCurrentGeojson(updated)
        };

        const options = {
            // source 지정X, store 에 직접 삽입 -> layer 가 store subscribe
            drawGeometryType: drawGeometryType
        };

        olEventManager.bind("drawend", onDrawEnd, options);

        return () => {
            olEventManager.unbind("drawend", onDrawEnd);
        };
    }, [ isDrawing ]);

    useEffect(() => {
        if (!isEditable) return;

        const onModifyEnd = (e: ModifyEvent) => {
            const features: Feature[] = e.features.getArray();

            const ids = features.map(f => f.get("id"));
            setSelectionId(ids);

            const currentGeojson = store.getState().currentGeojson!;
            const updated = features.reduce((acc, feature) => {
                const geojsonFeature = olFeatureToGeoJSONFeature(feature);
                return mergeGeoJSONFeatureIntoCollection({
                    feature: geojsonFeature,
                    featureCollection: acc,
                });
            }, currentGeojson);

            store.getState().setCurrentGeojson(updated);

            setTimeout(() => {
                const src = (layer as VectorLayer).getSource();
                if (!src) return;

                const newFeatures = ids
                    .map(id => src.getFeatures().find(f => f.get("id") === id))
                    .filter((f): f is Feature => !!f);

                const selection = selectInteractionRef.current?.getFeatures();
                if (selection) {
                    selection.clear();
                    selection.extend(newFeatures);
                }
                ids.forEach((id) => {
                    gridRef.current?.setSelectRowsWithField("id", id, true);
                });
            }, 50);

        };

        const options = {
            features: selectInteractionRef.current?.getFeatures() || layer?.getSource().getFeatures(),
        };

        olEventManager.bind("modifyend", onModifyEnd, options);

        return () => {
            olEventManager.unbind("modifyend", onModifyEnd);
        };
    }, [ isEditable, layer ]);

    useEffect(() => {
        const onSnap = (e) => {
            const currentFeature = e.feature;
            //featureType이 "edit"으로 끝나지 않으면 무시
            const props = currentFeature?.get("properties");
            const featureType = props?.featureType;

            if (typeof featureType !== "string" || !featureType.endsWith("edit")) return;
            lastSnappedFeatureRef.current = currentFeature
            //이전에 snap된 feature와 동일하면 무시
            // if (lastSnappedFeatureRef.current === currentFeature) return;
            // lastSnappedFeatureRef.current = currentFeature;
            // console.log("currentFeature geometry for offset:::",currentFeature.getGeometry())
            // console.log("currentFeature properties:::",currentFeature.getProperties().properties)
            // setBaseData({
            //     ...currentFeature.getProperties().properties
            // })
        };
        if (!networkLayer) {
            console.warn("networkLayer가 없습니다. snap 이벤트 비활성화됨");
            return;
        }
        const options = {
            olLayer: networkLayer,
        };

        olEventManager.bind("snap", onSnap, options);

        return () => {
            olEventManager.unbind("snap", onSnap);
        };
    }, [ isDrawing, isEditable ]);

    const handleCheck = () => {
        console.log("체크한 row:", gridRef.current?.getSelectedRow());
        console.log("그리드 업데이트 확인:", gridRef.current?.isGridChanged());
        console.log("changed?", gridRef.current?.getChangedValue())
        console.log("currentGeojson:", store.getState().currentGeojson) // 디버깅용
        console.log("currentFlatRow:", store.getState().flatRow) // 디버깅용
        console.log("currentSource:", layer.getSource().getFeatures()) // 디버깅용
        console.log("ids:", selectionIds) // 디버깅용
    };

    // currentGeojson -> flatRow -> Grid RowData 순차적으로 동기화
    useEffect(() => {
        if (!submenu.menuCode || !submenu.item?.fields) return;

        // 1. 초기 컬럼 정의 설정
        const defs = buildColumnDefs(submenu.item.fields);
        if (defs != colDefs) setColDefs(defs);

        if (!store) return

        // 2. 상태 구독: currentGeojson 변경 시 flatRow & rowData 동기화
        const unsubscribe = store.subscribe(
            (state) => state.currentGeojson,
            (currentGeojson) => {
                if (!currentGeojson) return;
                const flatRow = featureCollectionToFlatRow(currentGeojson);
                store.getState().setFlatRow(flatRow);
                if (rowData != flatRow) setRowData(flatRow);
                console.log("test flatRow updated by currentGeojson change:", flatRow);
            },
            { fireImmediately: true }
        );

        return () => {
            unsubscribe();
        };
    }, [ submenu.menuCode, store ]);

    const handleGridSelectionChanged = () => {
        // console.log("test handleGridSelectionChanged call")
        const selectedRows = gridRef.current?.getSelectedRow() ?? [];
        const selectedGridIds = selectedRows.map((row: Record<string, unknown>) => row.id);
        console.log("test handleGridSelectionChanged selectedIds:::", selectedGridIds)

        if (JSON.stringify(selectionIds) === JSON.stringify(selectedGridIds)) {
            return; // 이전 selection과 같으면 무시
        }
        setSelectionId(selectedGridIds)
    };


    const handleAddBtn = () => {
        const addedProperties = {
            id: Date.now(),
        }
        const baseData = {}
        const newRow = createRowFromOptions({ baseData, addedProperties });
        gridRef.current?.addRow(newRow)
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
                            <button className="add-btn"
                                    onClick={ () => handleDrawBtn() }>{ !isDrawing ? '그리기' : '그리기 취소' }</button>
                            <button className="delete-btn" onClick={ () => handleDeleteBtn() }>삭제</button>
                            <button className="save-btn" onClick={ () => handleSaveBtn() }>저장</button>
                            <button className="save-btn" onClick={ () => handleInitBtn() }>되돌리기</button>
                            <button className="edit-btn"
                                    onClick={ () => handleEditableBtn() }>{ !isEditable ? '편집 활성화' : '편집 비활성화' }</button>
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