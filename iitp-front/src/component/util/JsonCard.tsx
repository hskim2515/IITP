import React from "react";
import { Card, Typography } from "antd";

const { Title, Text } = Typography;

// ✅ 중첩 배열 이름을 기반으로 단수 이름 추출
const singularize = (plural: string) =>
    plural.endsWith("s") ? plural.slice(0, -1) : plural;

// ✅ 중첩 배열이 있는 키 추출
function getNestedArrayField(obj: any): string | null {
    if (!obj) return null;
    for (const key in obj) {
        if (Array.isArray(obj[key])) return key;
    }
    return null;
}

// ✅ 1개 객체를 카드로 렌더링
const JsonCard = ({ item, level }: { item: any; level: string }) => {
    const nestedField = getNestedArrayField(item);

    return (
        <Card
            size="small"
            style={{ marginBottom: 16 }}
            title={`${level} - ${item?.id || ""}`}
        >
            {Object.entries(item)
                .filter(([key, val]) => !Array.isArray(val))
                .map(([key, val]) => (
                    <p key={key}>
                        <Text strong>{key}:</Text> {String(val)}
                    </p>
                ))}

            {/* 재귀 렌더링: 하위 배열이 있을 경우 */}
            {nestedField && Array.isArray(item[nestedField]) && (
                <div style={{ paddingLeft: 16, borderLeft: "2px solid #eee", marginTop: 16 }}>
                    <Title level={5}>
                        {singularize(nestedField)} List
                    </Title>
                    <JsonCardGrid
                        rowData={item[nestedField]}
                        level={singularize(nestedField)}
                    />
                </div>
            )}
        </Card>
    );
};

// ✅ 카드 그리드
const JsonCardGrid = ({
                          rowData,
                          level = "Item",
                      }: {
    rowData: any[];
    level?: string;
}) => {
    if (!Array.isArray(rowData) || rowData.length === 0) return null;

    return (
        <div style={{ display: "flex", flexDirection: "column" }}>
            {rowData.map((item, index) => (
                <JsonCard key={item?.id || index} item={item} level={level} />
            ))}
        </div>
    );
};

export default JsonCardGrid;
