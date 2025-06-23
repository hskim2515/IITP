import { buildNewRow, featureToFlatRow } from "@utils/grid";
import { ColDef } from "ag-grid-community";
import { FeatureStoreFactoryType } from "@stores/useFeatureStoreFactory";
import { RefObject } from "react";
import { GridHandle } from "@type/GirdOptions";
import { Feature } from "ol";
import { GeoJSON } from "ol/format";

export interface AddOptions {
    id: null | string | number,
    baseData: Record<string, unknown>,
    addedProperties?: Record<string, unknown>
}

const useGrid = (gridRef: RefObject<GridHandle>, store: FeatureStoreFactoryType, colDefs: ColDef) => {

    // addRow는 row를 추가하기만 하도록
    // generate Row, mergeRow 등 baseData 와 added Properties 병합 메서드 필요
    // 생성할 객체 id,
    // 생성할 객체 속성 (geometry 포함)
    // 바탕이 되는 객체
    // 이렇게 3개의 인자를 넣도록



    const createRowFromOptions = ({
                                      baseData,
                                      addedProperties
                                  }: Omit<AddOptions, 'id'>): Record<string, unknown> => {
        console.log("flow test createRowFromOptions")
        console.log("flow test createRowFromOptions baseData:::", baseData)
        // baseData의 id는 무시
        const { id: ignored, ...baseProps } = baseData ?? {};

        // addedProperties가 geometry, id, selected 등을 포함한다고 가정
        const {
            id,
            geometry,
            selected = false,        // 기본 선택 상태
            ...otherProps            // 기타 속성들 (type 등)
        } = addedProperties ?? {};

        const props = {
            id,
            ...baseProps,
            ...otherProps,
            selected
        };

        console.log("flow test createRowFromOptions props:::", props)

        const newFeature = {
            type: "Feature",
            geometry,
            properties: props,
        };

        const prevGeojson = store.getState().currentGeojson;
        const updatedGeojson = {
            type: "FeatureCollection",
            features: [ ...(prevGeojson?.features ?? []), newFeature ]
        };

        const newRow = buildNewRow({ colDefs, defaultData: featureToFlatRow(newFeature) });
        const updatedRows = [ ...store.getState().flatRow, newRow ];

        // store.getState().setCurrentGeojson(updatedGeojson);
        // store.getState().setFlatRow(updatedRows);

        return newRow;
    };

    const deleteSelected = () => {
        const selectedRows: Record<string, unknown>[] = gridRef.current?.getSelectedRow() ?? [];
        const selectedIds = selectedRows.map(row => row.id).filter(Boolean);

        const prevGeojson = store.getState().currentGeojson;
        const updatedGeojson = {
            ...prevGeojson,
            features: prevGeojson?.features.filter(f => !selectedIds.includes(f.properties?.id)) ?? []
        };

        const updatedRows = store.getState().flatRow.filter(row => !selectedIds.includes(row.id));

        store.getState().setCurrentGeojson(updatedGeojson);
        store.getState().setFlatRow(updatedRows);
        gridRef.current?.removeSelectedRow();
    };

    const saveModifiedFeatures = (features: Feature[]) => {
        console.log("flow test saveModifiedFeatures")
        console.log("props saveModifiedFeatures")
        console.log("props saveModifiedFeatures features:::", features)
        const geojsonFormat = new GeoJSON();

        features.forEach((feature) => {
            const id = feature.get("id");
            if (!id) return;

            const geojsonFeature = geojsonFormat.writeFeatureObject(feature, {
                featureProjection: "EPSG:3857",
                dataProjection: "EPSG:4326"
            });

            const updatedRow = featureToFlatRow(geojsonFeature);
            if (!updatedRow.id) updatedRow.id = id;

            // Grid update
            gridRef.current?.setRowDataByField({ field: "id", value: id }, updatedRow);
            gridRef.current?.setSelectRowsWithField("id", id);

            // 상태 업데이트
            const updatedRows = store.getState().flatRow.map(row =>
                row.id === id ? updatedRow : row
            );
            const updatedGeojson = {
                ...store.getState().currentGeojson,
                features: (store.getState().currentGeojson?.features ?? []).map((f) =>
                    f.properties?.id === id ? geojsonFeature : f
                ),
            };

            store.getState().setFlatRow(updatedRows);
            store.getState().setCurrentGeojson(updatedGeojson);
        });
    };

    const updateFeatureByRow = () => {
        // console.log("test call updateFeatureByRow")
        // const row = gridRef.current?.getChangedValue();
        // if (!row || typeof row !== "object") return;
        //
        // const id = row.id;
        // if (typeof id !== "string" && typeof id !== "number") return;
        //
        // const currentGeojson = store.getState().currentGeojson;
        // if (!currentGeojson) return;
        //
        // const updatedFeatures = currentGeojson.features.map((feature) => {
        //     if (feature.properties?.id !== id) return feature;
        //
        //     // geometry 갱신
        //     const newGeometry = {
        //         type: row.geometryType ?? feature.geometry?.type,
        //         coordinates: [
        //             row.lon ?? feature.geometry?.coordinates?.[0],
        //             row.lat ?? feature.geometry?.coordinates?.[1]
        //         ]
        //     };
        //
        //     return {
        //         ...feature,
        //         properties: {
        //             ...feature.properties,
        //             ...row,
        //         },
        //         geometry: newGeometry
        //     };
        // });
        //
        // store.getState().setCurrentGeojson({
        //     ...currentGeojson,
        //     features: updatedFeatures,
        // });
    };

    const switchEditable = (active: boolean) => {
        gridRef.current?.switchEditable(active)
    }

    return {
        createRowFromOptions,
        deleteSelected,
        updateFeatureByRow,
        switchEditable
    };
};
export default useGrid;