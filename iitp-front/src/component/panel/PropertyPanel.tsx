import React, { useEffect, useRef, useState } from 'react';
import "/static/css/styles.css";
import { MenuTree } from "@stores/useMenuStore";
import { propertyFormSchema } from "../form/propertyFormSchema";
import Grid from "../util/Grid";
import { buildColumnDefs, featureCollectionToFlatRow, } from "@utils/grid";
import { ColDef } from "ag-grid-community";
import { GridHandle } from "@type/GirdOptions";
import { Feature, MapBrowserEvent } from "ol";
import { menuCodeToStoreMap } from "@hooks/useFeatureInit";
import { useEventStore } from "@stores/useEventStore";
import { useOpenLayersStore } from "@stores/useOpenLayersStore";
import { OpenLayersScreenSpaceEventType } from "@type/OpenLayersKeyOptions";
import useModifyInteraction from "@hooks/interaction/useModifyInteraction";
import useGrid from "@hooks/useGrid";

export interface BottomTableProps {
    activeSubmenu: MenuTree
    onClose: () => void;
}

const PropertyPanel = ({ activeSubmenu, onClose }: BottomTableProps) => {
    const submenu = {
        menuCode: activeSubmenu.menuCode,
        item: propertyFormSchema[activeSubmenu.menuCode],
        title: activeSubmenu.nameKor
    }
    const gridRef = useRef<GridHandle>(null)

    const manager = useEventStore.getState().olEventManager;
    // 동적 스토어
    const store = menuCodeToStoreMap[submenu.menuCode];

    const [ pickedFeature, setPickedFeature ] = useState()

    const [ defaultData, setDefaultData ] = useState<Record<string, number | string>>({})

    const [ rowData, setRowData ] = useState<Record<string, unknown>[]>([])
    const [ colDefs, setColDefs ] = useState<ColDef[] | undefined>(undefined)

    const map = useOpenLayersStore.state.map()

    const {
        addRow,
        deleteSelected,
        saveModifiedFeatures,
        updateFeatureByRow,
        switchEditable
    } = useGrid(gridRef, store, colDefs)

    useEffect(() => {
        if (!manager || !submenu.menuCode || !map) return;

        const onSelect = (e: MapBrowserEvent) => {
            const pixel = map.getEventPixel(e.originalEvent);
            const coordinate = e.coordinate; // 클릭한 좌표

            map.forEachFeatureAtPixel(
                pixel,
                (feature) => {
                    setPickedFeature(feature);
                    const id = feature.get("id");
                    if (id) {
                        gridRef.current?.setSelectRowsWithField("id", [ id ]);
                    }

                    const geom = feature.getGeometry();
                    if (geom?.getType() === "LineString") {
                        const closestPoint = geom.getClosestPoint(coordinate);
                        console.log("[LineString] 클릭한 위치와 가장 가까운 점:", closestPoint);
                    }
                },
                {
                    layerFilter: (layer) =>
                        layer["layer"] === "NETWORK" || layer["layer"] === submenu.menuCode,
                }
            );
        };

        manager.bind("select", onSelect);
        return () => {
            manager.unbind("select", onSelect);
        };
    }, [ submenu.menuCode ]);

    useEffect(() => {
        console.log("pickedFeature:::", pickedFeature) // select 디버깅용
    }, [ pickedFeature ]);

    // 일단 click, dbclick 등은 event로 관리, interaction 은 추후 개편
    const modifyInteraction = useModifyInteraction({
        layerName: submenu.menuCode,
        condition: {
            button: OpenLayersScreenSpaceEventType.MIDDLE_CLICK
        },
        onModifyEnd: e => {
            const features: Feature[] = e.features.getArray(); // ✅ Collection → 배열
            saveModifiedFeatures(features);
            return features
        }
    })


    const handleCheck = () => {
        // console.log("선택된 feature:", selectInteraction.ref.current);
        // selectInteraction.ref.current.map((feature: Feature) => {
        //     console.log("id:::", feature.get("id"))
        // });
        //
        // console.log("그려진 feature:", drawInteraction.ref.current);
        // console.log("이동된 feature:", modifyInteraction.ref.current);
        console.log("체크한 row:", gridRef.current?.getSelectedRow());
        console.log("그리드 업데이트 확인:", gridRef.current?.isGridChanged());
        console.log("changed?", gridRef.current?.getChangedValue())
        console.log("currentGeojson:", store.getState().currentGeojson) // 디버깅용
    };

    // currentGeojson 기반으로 Grid용 데이터 가공
    useEffect(() => {
        console.log("rowData menu:::", submenu.menuCode)
        if (!submenu.menuCode || !submenu.item?.fields) return;
        if (!store) {
            setRowData([])
            return;
        }
        console.log("rowData store.getState():::", store.getState())
        const currentGeojson = store.getState().currentGeojson
        const flatRow = featureCollectionToFlatRow(currentGeojson);

        console.log("rowData currentGeojson:::", currentGeojson)
        console.log("rowData flatRow:::", flatRow)
        store.getState().setFlatRow(flatRow)
        setRowData(flatRow);
        const defs = buildColumnDefs(submenu.item.fields);
        setColDefs(defs);

    }, [ submenu.menuCode ]);


    const handleAddBtn = () => {
        addRow()
    }

    const handleDeleteBtn = () => {
        deleteSelected()
    }

    const handleSaveBtn = () => {
        console.log(store.getState().currentGeojson)
    }

    const handleEditableBtn = () => {
        switchEditable()
    }

    const handleInitBtn = () => {
        store.getState().initCurrentData()
        const restoredGeojson = store.getState().currentGeojson;
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
                            <button className="add-btn" onClick={ () => handleAddBtn() }>추가</button>
                            <button className="delete-btn" onClick={ () => handleDeleteBtn() }>삭제</button>
                            <button className="save-btn" onClick={ () => handleSaveBtn() }>저장</button>
                            <button className="save-btn" onClick={ () => handleInitBtn() }>되돌리기</button>
                            <button className="edit-btn" onClick={ () => handleEditableBtn() }>그리드 편집활성화</button>
                            <button onClick={ () => handleCheck() }>Interaction 객체 목록 log 확인</button>
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
                            />
                        }
                    </div>
                </div>
            </div>

        </>
    );
};

export default PropertyPanel;