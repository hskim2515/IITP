import { ColDef } from "ag-grid-community";
import ColorCellRenderer from "../component/util/ColorCellRenderer";
import FileCellRenderer from "../component/util/FileCellRenderer";
import { PropertyFieldType } from "@type/PropertyField";

// property schema 를 받아서 grid colDef 로 변환
export const buildColumnDefs = (fields: PropertyFieldType[]): ColDef[] => [
    {
        headerName: 'No',
        valueGetter: 'node.rowIndex + 1',
        width: 60,
    },
    ...fields.map((field) => ({
        headerName: field.label,
        field: field.name,
        editable: false,
        singleClickEdit: true,
        type: field.type,
        cellRenderer: getCellRenderer(field.type),
    }))
];

const getCellRenderer = (type?: string) => {
    switch (type) {
        case 'color':
            return ColorCellRenderer;
        case 'file':
            return FileCellRenderer;
        default:
            return undefined;
    }
};

const defaultValueByType: Record<string, unknown> = {
    number: 0,
    boolean: false,
    date: new Date(),
    array: [],
    object: {},
    string: '',
    text: '',
};

interface BuildNewRowOptions {
    colDefs: ColDef[] | undefined;
    defaultData?: Record<string, unknown>;
}

/**
 * colDefs 기반 rowData 로 가공
 * @param colDefs col 정보
 * @param defaultData 추가할 row 에 연계할 값 (예: linkRef, id, laneRef, ...)
 */
export const buildNewRow = ({
                                colDefs,
                                defaultData = {}
                            }: BuildNewRowOptions): Record<string, unknown> => {
    const newRow: Record<string, unknown> = {};

    colDefs?.forEach((col) => {
        const key = col.field;
        if (!key) return;

        if (key === 'id') {
            newRow[key] = defaultData[key] ?? Date.now();
        } else if (defaultData[key] !== undefined) {
            newRow[key] = defaultData[key];
        } else {
            newRow[key] = defaultValueByType[col.type ?? 'string'];
        }
    });

    return newRow;
};

export function featureCollectionToFlatRow(
    featureCollection: GeoJSON.FeatureCollection,
): Record<string, unknown>[] {
    console.log("rowData featureCollectionToFlatRow init")
    if (!featureCollection || featureCollection.type !== "FeatureCollection" || !Array.isArray(featureCollection.features)) return [];
    console.log("rowData featureCollectionToFlatRow logic")
    return featureCollection.features.map(featureToFlatRow) || []
}

export function featureToFlatRow(feature: GeoJSON.Feature): Record<string, unknown> {
    const props = feature.properties || {};
    const geom = feature.geometry;

    const flatRow: Record<string, unknown> = {
        ...props,
    };

    if (geom) {
        flatRow.geometryType = geom.type;

        switch (geom.type) {
            case "Point": {
                const coords = geom.coordinates as [ number, number ];
                flatRow.lon = coords[0];
                flatRow.lat = coords[1];
                break;
            }
            case "LineString":
            case "MultiPoint":
            case "Polygon":
            case "MultiLineString":
            case "MultiPolygon": {
                flatRow.lon = null;
                flatRow.lat = null;
                flatRow.coordinatesText = JSON.stringify(geom.coordinates);
                break;
            }
            default:
                break;
        }
    }

    return flatRow;
}


// 조회에 따라 response data가 {} 또는 [{}] 임
export function flatRowToForm(defaultData: Record<string, unknown>, responseData: unknown, inputFields: [ Record<string, string> ], dataFields: [ Record<string, string> ]) {
    let mappedFormData: string[][] = [];
    let mappedMetaData: Record<string, string> = {};
    console.log("flatRowToForm defaultData responseData:::", responseData)
    if (Array.isArray(responseData) && responseData.length > 0) {
        mappedFormData = responseData.map(item =>
            inputFields.map(col => {
                return item[col.name] ?? ''
            })
        );
        mappedMetaData = dataFields.reduce((acc, col) => {
            acc[col.name] = responseData[0][col.name] ?? '';
            return acc;
        }, {} as Record<string, string>);
    } else if (defaultData && responseData.length == 0) { //배열이 아니라 단일 객체 조회일 경우
        console.log("flatRowToForm defaultData responseData:::", responseData)
        console.log("flatRowToForm defaultData:::", defaultData)
        mappedFormData = inputFields.map(col => defaultData[col.name] ?? '')
    } else if (typeof responseData === 'object' && responseData !== null) { //배열이 아니라 단일 객체 조회일 경우
        mappedFormData = inputFields.map(col => responseData[col.name] ?? '');
    } else {
        mappedFormData = [];
        mappedMetaData = {};
    }

    return { mappedFormData, mappedMetaData };
}