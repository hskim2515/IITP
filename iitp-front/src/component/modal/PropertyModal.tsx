import React, { useMemo, useState } from "react";
import { usePropertyStore } from "@stores/usePropertyStore";
import { findMenuByCode, useMenuStore } from "@stores/useMenuStore";
import { faClose, faEdit, faChevronDown, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useSchemaStore } from "@stores/useSchemaStore";
import { findMenuCodeBySchemaDefinition } from "@utils/schema";
import { propertyFormSchema } from "@schema/propertyFormSchema";
import { useNetworkDrawStore } from "@stores/useNetworkDrawStore";

// 모든 스키마에서 fieldName → label 역인덱스 빌드
function buildFieldLabelMap(): Record<string, string> {
    const map: Record<string, string> = {};
    Object.values(propertyFormSchema).forEach((schema) => {
        [...(schema.fields ?? []), ...(schema.inputFields ?? []), ...(schema.rowFields ?? [])].forEach((f) => {
            if (f.name && f.label) map[f.name] = f.label;
        });
    });
    return map;
}

const FIELD_LABEL_MAP = buildFieldLabelMap();
const INTERNAL_KEYS = new Set(['__guid', 'featureType']);
const MAX_STR_LEN = 80;

function truncate(s: string, max = MAX_STR_LEN) {
    return s.length <= max ? s : s.slice(0, max) + '…';
}

interface ValueCellProps {
    propKey: string;
    value: unknown;
}

const ValueCell = ({ propKey, value }: ValueCellProps) => {
    const [expanded, setExpanded] = useState(false);

    if (Array.isArray(value)) {
        return (
            <span>
                <button
                    onClick={() => setExpanded(p => !p)}
                    style={styles.arrayToggle}
                >
                    <FontAwesomeIcon
                        icon={expanded ? faChevronDown : faChevronRight}
                        style={{ marginRight: 4, fontSize: 10 }}
                    />
                    {value.length}개
                </button>
                {expanded && (
                    <div style={styles.arrayList}>
                        {value.map((item, i) => (
                            <div key={i} style={styles.arrayItem}>
                                <span style={styles.arrayIndex}>{i}</span>
                                <span>{typeof item === 'object' ? truncate(JSON.stringify(item)) : String(item)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </span>
        );
    }

    if (value !== null && typeof value === 'object') {
        const str = JSON.stringify(value);
        return <span title={str} style={styles.valueText}>{truncate(str)}</span>;
    }

    const str = String(value ?? '');
    return <span title={str} style={styles.valueText}>{truncate(str)}</span>;
};

const PropertyModal = () => {
    const selectedProps = usePropertyStore((state) => state.selectedProps);
    const setSelectedProps = usePropertyStore((state) => state.setSelectedProps);
    const { activeSubmenu, menu, setActiveSubmenu } = useMenuStore();
    // 선택·편집 모드 중에는 속성 모달 숨김 — 편집 클릭마다 모달이 함께 떠서 조작을 가림.
    // (selectedProps 자체는 유지 — 레인/셀 선택 하이라이트 오버레이가 이를 사용)
    const isSelectActive = useNetworkDrawStore((s) => s.isSelectActive);
    const getSchemaDefinitionBySchemaDefinitionName = useSchemaStore.getState().getSchemaDefinitionBySchemaDefinitionName;

    const displayEntries = useMemo(() => {
        if (!selectedProps) return [];
        return Object.entries(selectedProps).filter(([key]) => !INTERNAL_KEYS.has(key));
    }, [selectedProps]);

    if (!selectedProps || Object.keys(selectedProps).length === 0) return null;
    if (activeSubmenu) return null;
    if (isSelectActive) return null; // 선택·편집 중엔 미표시 (속성 확인은 보기 모드/그리드에서)

    const featureType = selectedProps.featureType as string | undefined;

    const onClickClose = () => setSelectedProps(null);

    const onClickEdit = () => {
        if (!featureType || !menu) return;
        const menuCode = findMenuCodeBySchemaDefinition(
            getSchemaDefinitionBySchemaDefinitionName(featureType)
        );
        if (!menuCode) return;
        const foundMenu = findMenuByCode(menu, menuCode);
        if (foundMenu) setActiveSubmenu(foundMenu);
    };

    return (
        <div style={styles.container}>
            {/* 헤더 */}
            <div style={styles.header}>
                <span style={styles.featureType}>{featureType ?? '속성'}</span>
                <div style={styles.actions}>
                    <button style={styles.iconBtn} title="편집" onClick={onClickEdit}>
                        <FontAwesomeIcon icon={faEdit} />
                    </button>
                    <button style={styles.iconBtn} title="닫기" onClick={onClickClose}>
                        <FontAwesomeIcon icon={faClose} />
                    </button>
                </div>
            </div>

            {/* 속성 테이블 */}
            <div style={styles.scrollArea}>
                <table style={styles.table}>
                    <thead>
                        <tr>
                            <th style={{ ...styles.th, width: '40%' }}>속성</th>
                            <th style={styles.th}>값</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayEntries.map(([key, value]) => (
                            <tr key={key} style={styles.row}>
                                <td style={styles.tdKey} title={key}>
                                    {FIELD_LABEL_MAP[key] ?? key}
                                </td>
                                <td style={styles.tdValue}>
                                    <ValueCell propKey={key} value={value} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const styles = {
    container: {
        position: 'fixed' as const,
        bottom: '100px',
        right: '16px',
        width: '380px',
        maxHeight: '45vh',
        display: 'flex',
        flexDirection: 'column' as const,
        backgroundColor: 'rgba(16, 18, 28, 0.97)',
        border: '1px solid rgba(0, 200, 255, 0.2)',
        borderRadius: '8px',
        zIndex: 2000,
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.5), 0 0 12px rgba(0, 200, 255, 0.08)',
        backdropFilter: 'blur(8px)',
        overflow: 'hidden',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        backgroundColor: 'rgba(0, 180, 255, 0.08)',
        flexShrink: 0,
    },
    featureType: {
        fontSize: '13px',
        fontWeight: 600,
        color: '#5dd0ff',
        letterSpacing: '0.4px',
    },
    actions: {
        display: 'flex',
        gap: '4px',
    },
    iconBtn: {
        background: 'none',
        border: 'none',
        color: '#aaa',
        cursor: 'pointer',
        padding: '4px 6px',
        borderRadius: '4px',
        fontSize: '13px',
        lineHeight: 1,
        transition: 'color 0.15s',
    },
    scrollArea: {
        overflowY: 'auto' as const,
        flex: 1,
    },
    table: {
        width: '100%',
        borderCollapse: 'collapse' as const,
        fontSize: '12px',
    },
    th: {
        textAlign: 'left' as const,
        padding: '6px 10px',
        backgroundColor: 'rgba(30, 35, 55, 0.9)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        color: '#7aa2cc',
        fontWeight: 600,
        fontSize: '11px',
        letterSpacing: '0.5px',
        position: 'sticky' as const,
        top: 0,
    },
    row: {
        borderBottom: '1px solid rgba(255,255,255,0.04)',
    },
    tdKey: {
        padding: '6px 10px',
        color: '#8899bb',
        verticalAlign: 'top' as const,
        fontSize: '12px',
        whiteSpace: 'nowrap' as const,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: '150px',
    },
    tdValue: {
        padding: '6px 10px',
        color: '#dde8f0',
        verticalAlign: 'top' as const,
        fontSize: '12px',
        wordBreak: 'break-all' as const,
    },
    valueText: {
        display: 'block',
    },
    arrayToggle: {
        background: 'rgba(0, 180, 255, 0.1)',
        border: '1px solid rgba(0, 180, 255, 0.3)',
        borderRadius: '4px',
        color: '#5dd0ff',
        cursor: 'pointer',
        padding: '2px 8px',
        fontSize: '11px',
        display: 'inline-flex',
        alignItems: 'center',
    },
    arrayList: {
        marginTop: '6px',
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '2px',
        maxHeight: '120px',
        overflowY: 'auto' as const,
    },
    arrayItem: {
        display: 'flex',
        gap: '6px',
        fontSize: '11px',
        color: '#b0c4d8',
    },
    arrayIndex: {
        color: '#5dd0ff',
        minWidth: '18px',
        fontVariantNumeric: 'tabular-nums',
    },
} as const;

export default PropertyModal;
