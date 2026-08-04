import React, { useEffect, useState } from 'react';
import { Scenario, ScenarioVersions } from '@type/Scenario';
import NetworkMiniPreviewMap from './NetworkMiniPreviewMap';

interface Props {
    scenario: Scenario;
    onSelectVersion: (scenario: Scenario, version: ScenarioVersions) => void;
}

const ScenarioPreviewPopover: React.FC<Props> = ({ scenario, onSelectVersion }) => {
    const [versions, setVersions] = useState<ScenarioVersions[] | null>(null);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch(import.meta.env.VITE_API_URL + `/scenario/${scenario.id}/versions`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        })
            .then((r) => r.json())
            .then((data: ScenarioVersions[]) => {
                if (cancelled) return;
                setVersions(data);
                // 최근 수정된 버전을 기본 미리보기 대상으로
                const latest = [...data].sort((a, b) => (b.modifyDate ?? '').localeCompare(a.modifyDate ?? ''))[0];
                setSelectedKey(latest?.key ?? null);
            })
            .catch(() => { if (!cancelled) setVersions([]); });
        return () => { cancelled = true; };
    }, [scenario.id]);

    return (
        // 바깥 래퍼는 카드 바로 아래(top:100%, 갭 없음)에서 시작해 투명 paddingTop 만큼
        // 히트박스를 확장한다 — 카드 hover 영역과 팝오버 hover 영역 사이에 빈 픽셀 구간이
        // 생기면(예: top: calc(100% + 8px)) 그 구간을 지나는 동안 마우스가 어떤 요소 위에도
        // 있지 않게 돼 카드의 onMouseLeave 가 먼저 발동해 버전 쪽으로 이동하기도 전에
        // 팝오버가 닫힌다. Header.module.css 의 드롭다운(.container padding-bottom 트릭)과
        // 동일한 해법 — 시각적 간격은 안쪽 padding 으로, 히트박스는 바깥 래퍼로 이어붙인다.
        <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, paddingTop: 8 }}
        >
            <div style={{
                background: 'rgba(var(--surface-popover-rgb), 0.98)', backdropFilter: 'blur(16px)',
                border: '1px solid rgba(var(--scenario-accent-rgb), 0.25)', borderRadius: 10,
                boxShadow: '0 12px 32px rgba(var(--surface-overlay-rgb), 0.6)', padding: 12,
                display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left', cursor: 'default',
            }}>
                <div style={{ width: '100%', height: 130 }}>
                    {selectedKey ? (
                        <NetworkMiniPreviewMap versionId={selectedKey} />
                    ) : (
                        <div style={{
                            width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'rgb(var(--surface-2-rgb))', borderRadius: 6, fontSize: 11, color: 'rgba(var(--overlay-rgb), 0.4)',
                        }}>
                            {versions === null ? '불러오는 중...' : '버전 없음'}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 110, overflowY: 'auto' }}>
                    {versions === null && (
                        <span style={{ fontSize: 11, color: 'rgba(var(--overlay-rgb), 0.4)' }}>버전 정보를 불러오는 중...</span>
                    )}
                    {versions?.length === 0 && (
                        <span style={{ fontSize: 11, color: 'rgba(var(--overlay-rgb), 0.4)' }}>등록된 버전이 없습니다.</span>
                    )}
                    {versions?.map((v) => (
                        <div
                            key={v.key}
                            onMouseEnter={() => setSelectedKey(v.key)}
                            onClick={() => onSelectVersion(scenario, v)}
                            title={`${v.label} 버전 편집하기`}
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '4px 7px', borderRadius: 5, cursor: 'pointer',
                                background: v.key === selectedKey ? 'rgba(var(--scenario-accent-rgb), 0.12)' : 'transparent',
                                border: `1px solid ${v.key === selectedKey ? 'rgba(var(--scenario-accent-rgb), 0.35)' : 'transparent'}`,
                            }}
                        >
                            <span style={{ fontSize: 12, color: v.key === selectedKey ? 'var(--scenario-accent)' : 'var(--text-secondary)', fontWeight: 600 }}>
                                {v.label}
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 10, color: 'rgba(var(--overlay-rgb), 0.4)' }}>
                                    {(v.modifyDate ?? v.insertDate ?? '').slice(0, 10)}
                                </span>
                                {v.key === selectedKey && (
                                    <span style={{ fontSize: 10, color: 'var(--scenario-accent)' }}>편집 →</span>
                                )}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ScenarioPreviewPopover;
