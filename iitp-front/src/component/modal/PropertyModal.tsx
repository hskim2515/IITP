import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// propertyFormSchema(NETWORK 엔트리)는 CRUD 폼 전용이라 network Node/Link/Lane/Connection의
// 실제 필드명과 다수 어긋나 있다(예: ffspeed↔ffSpd, laneWidth↔width — Network.ts 기준 실제
// 키가 아님) — 그 결과 속성 팝업에서 라벨 없이 원시 필드명이 그대로 노출됐다. propertyFormSchema
// 자체를 고치면 그 CRUD 폼 쪽 바인딩까지 건드리게 되므로, 이 팝업 전용으로 실제 키 기준
// 라벨을 별도로 추가해 위 맵을 보강한다(겹치는 키는 이쪽이 더 정확하므로 우선).
const NETWORK_FIELD_LABELS: Record<string, string> = {
    fromNode: "시작 노드", toNode: "종료 노드",
    length: "길이 (m)", width: "폭 (m)",
    maxSpd: "최고 속도 (km/h)", minSpd: "최저 속도 (km/h)",
    ffSpd: "자유흐름 속도 (km/h)", waveSpd: "충격파 속도 (km/h)",
    qmax: "최대 교통량 (qmax)", maxVeh: "최대 차량 수",
    simType: "시뮬레이션 유형", type: "유형", layer: "레이어",
    numPort: "포트 수", numConnection: "커넥션 수", v2x: "V2X", center: "중심 좌표",
    linkRef: "소속 링크 ID", leftLaneId: "좌측 차로 ID", rightLaneId: "우측 차로 ID",
    numCell: "셀 수", rightLC: "우측 차로변경 가능", leftLC: "좌측 차로변경 가능",
    laneAccessType: "차로 접근 유형",
    fromLink: "진입 링크", toLink: "진출 링크", fromLane: "진입 차로", toLane: "진출 차로",
    turning: "회전 방향",
};

const FIELD_LABEL_MAP = { ...buildFieldLabelMap(), ...NETWORK_FIELD_LABELS };
const INTERNAL_KEYS = new Set(['__guid', 'featureType']);
// 필드가 이보다 많으면 스키마 순서상 앞쪽 핵심 필드만 기본 표시하고 나머지는 "더보기"로 접는다.
const DEFAULT_VISIBLE_FIELD_COUNT = 8;
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
    const [expanded, setExpanded] = useState(false);

    // 드래그 이동 — 기본 위치(우하단 고정)는 CSS bottom/right로 유지하다가, 한 번 드래그하면
    // 그 이후로는 top/left 절대좌표로 전환해 사용자가 옮긴 자리에 계속 떠 있게 한다(선택 항목이
    // 바뀌어도 위치는 유지 — expanded와 달리 리셋하지 않음).
    const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
    const posRef = useRef<{ x: number; y: number } | null>(null);

    const handleDragMove = useCallback((e: MouseEvent) => {
        const el = containerRef.current;
        if (!el) return;
        const width = el.offsetWidth;
        const height = el.offsetHeight;
        const x = Math.min(Math.max(0, e.clientX - dragOffsetRef.current.dx), window.innerWidth - width);
        const y = Math.min(Math.max(0, e.clientY - dragOffsetRef.current.dy), window.innerHeight - height);
        posRef.current = { x, y };
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
    }, []);

    const handleDragEnd = useCallback(() => {
        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);
        document.body.style.userSelect = 'auto';
        if (posRef.current) setPosition(posRef.current);
    }, [handleDragMove]);

    const handleDragStart = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button')) return; // 편집/닫기 버튼 클릭은 드래그로 취급하지 않음
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        dragOffsetRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
        document.addEventListener('mousemove', handleDragMove);
        document.addEventListener('mouseup', handleDragEnd);
        document.body.style.userSelect = 'none';
    }, [handleDragMove, handleDragEnd]);

    useEffect(() => {
        return () => {
            document.removeEventListener('mousemove', handleDragMove);
            document.removeEventListener('mouseup', handleDragEnd);
        };
    }, [handleDragMove, handleDragEnd]);

    // 스키마(layer_schema_field)에 정의된 ACTIVE 필드 순서를 그대로 우선순위로 사용 — GridTable이
    // 편집 그리드 컬럼을 만들 때 쓰는 것과 같은 순서라 그리드와 이 팝업의 필드 배치가 일관된다.
    // 스키마에 없는 나머지 값(구조 전용 필드 등)은 숨기지 않고 뒤에 그대로 붙인다.
    const orderedEntries = useMemo(() => {
        if (!selectedProps) return [];
        const entries = Object.entries(selectedProps).filter(([key]) => !INTERNAL_KEYS.has(key));

        const featureType = selectedProps.featureType as string | undefined;
        const schemaDef = featureType ? getSchemaDefinitionBySchemaDefinitionName(featureType) : null;
        const activeFieldNames = (schemaDef?.fields ?? [])
            .filter((f) => f.status === 'ACTIVE' && f.name)
            .map((f) => f.name as string);
        if (activeFieldNames.length === 0) return entries;

        const remaining = new Map(entries);
        const ordered: [string, unknown][] = [];
        for (const name of activeFieldNames) {
            if (remaining.has(name)) {
                ordered.push([name, remaining.get(name)]);
                remaining.delete(name);
            }
        }
        for (const rest of remaining) ordered.push(rest);
        return ordered;
    }, [selectedProps, getSchemaDefinitionBySchemaDefinitionName]);

    const hasMoreFields = orderedEntries.length > DEFAULT_VISIBLE_FIELD_COUNT;
    const displayEntries = expanded || !hasMoreFields
        ? orderedEntries
        : orderedEntries.slice(0, DEFAULT_VISIBLE_FIELD_COUNT);

    // 다른 시설물을 클릭해 선택이 바뀌면 이전에 펼쳐둔 상태를 초기화 — 새 항목도 항상 접힌
    // 상태로 시작해야 "핵심 필드만 먼저 보인다"는 기대가 일관되게 유지된다.
    useEffect(() => {
        setExpanded(false);
    }, [selectedProps?.__guid]);

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

    const containerStyle: React.CSSProperties = position
        ? { ...styles.container, left: position.x, top: position.y, right: 'auto', bottom: 'auto' }
        : styles.container;

    return (
        <div ref={containerRef} style={containerStyle}>
            {/* 헤더 — 드래그 핸들 (버튼 제외) */}
            <div style={styles.header} onMouseDown={handleDragStart}>
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
                        {displayEntries.map(([key, value], i) => (
                            <tr key={key} style={i % 2 === 1 ? { ...styles.row, ...styles.rowAlt } : styles.row}>
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
                {hasMoreFields && (
                    <button style={styles.moreBtn} onClick={() => setExpanded((e) => !e)}>
                        {expanded ? "간단히 보기" : `+${orderedEntries.length - DEFAULT_VISIBLE_FIELD_COUNT}개 속성 더보기`}
                    </button>
                )}
            </div>
        </div>
    );
};

const styles = {
    container: {
        position: 'fixed' as const,
        bottom: '100px',
        right: '16px',
        width: '420px',
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
        cursor: 'grab',
        userSelect: 'none' as const,
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
    rowAlt: {
        backgroundColor: 'rgba(255,255,255,0.02)',
    },
    tdKey: {
        padding: '7px 10px',
        color: '#8899bb',
        verticalAlign: 'top' as const,
        fontSize: '12px',
        whiteSpace: 'nowrap' as const,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: '170px',
    },
    tdValue: {
        padding: '7px 10px',
        color: '#dde8f0',
        verticalAlign: 'top' as const,
        fontSize: '12px',
        overflowWrap: 'break-word' as const,
    },
    moreBtn: {
        display: 'block',
        width: '100%',
        padding: '7px 0',
        background: 'rgba(0, 180, 255, 0.06)',
        border: 'none',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        color: '#5dd0ff',
        cursor: 'pointer',
        fontSize: '11px',
        fontWeight: 600,
        position: 'sticky' as const,
        bottom: 0,
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
