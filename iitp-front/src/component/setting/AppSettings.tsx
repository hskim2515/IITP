import React, { useEffect } from 'react';
import { useAppSettingsStore } from '@stores/useAppSettingsStore';
import { useLayerSchemaStore } from '@stores/useLayerSchemaStore';
import styles from '@css/ToolsPanel.module.css';

/**
 * 앱 전역 설정(⚙ 설정 팝업) — 시나리오/버전과 무관하게 이 브라우저에 저장되는 개인 취향 설정.
 * 이전엔 이 팝업이 QA용 "테스트 설정"(더미 차량 속도/대수 슬라이더, 실사용자에게 무의미)만
 * 있었는데, 실제로 쓸모 있는 설정으로 교체:
 *   - 배경지도 기본값: 지금까지는 서버 스키마의 basic 필드로만 정해져 사용자가 바꿀 수 없었음.
 * (편집 중 자동저장 주기 설정은 한 번 검토했다가 제외했다 — 사용자가 명시적으로 저장하지 않은
 *  변경을 물어보지도 않고 강제로 저장해버리는 건 잘못된 동작이라 판단, useNetworkDraw.ts의
 *  주기적 체크포인트 저장 자체를 제거함.)
 */
const AppSettings: React.FC = () => {
    const defaultBaseMap = useAppSettingsStore((s) => s.defaultBaseMap);
    const setDefaultBaseMap = useAppSettingsStore((s) => s.setDefaultBaseMap);

    const { groups, fetchLayerSchema, loading } = useLayerSchemaStore();
    useEffect(() => { if (!loading) fetchLayerSchema(); }, []);
    const baseMapFields = groups.find((g) => g.key === 'baseMap')?.layers ?? [];

    return (
        <div>
            <div className={styles.sectionLabel} style={{ cursor: 'default' }}>배경지도 기본값</div>
            <div style={{ padding: '0 4px 4px' }}>
                <label className={styles.layerItem}>
                    <input
                        type="radio"
                        name="defaultBaseMap"
                        checked={defaultBaseMap === null}
                        onChange={() => setDefaultBaseMap(null)}
                    />
                    (서버 기본값 사용)
                </label>
                {baseMapFields.map((field) => (
                    <label key={field.key} className={styles.layerItem}>
                        <input
                            type="radio"
                            name="defaultBaseMap"
                            checked={defaultBaseMap === field.key}
                            onChange={() => setDefaultBaseMap(field.key)}
                        />
                        {field.label}
                    </label>
                ))}
            </div>
        </div>
    );
};

export default AppSettings;
