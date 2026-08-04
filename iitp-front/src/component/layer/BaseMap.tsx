import React, { useEffect } from 'react';
import { BaseMapType, useMapStore } from '@stores/useMapStore';
import { LayerField } from "@stores/useLayerSchemaStore";
import { useLayerStore } from "@stores/useLayerStore";
import { useCesiumStore } from "@stores/useCesiumStore";
import { useAppSettingsStore } from "@stores/useAppSettingsStore";
import styles from "@css/ToolsPanel.module.css";

export interface Props {
    fields: LayerField[];
}

const BaseMap = ({ fields }: Props) => {
    const currentBaseMap = useMapStore.state.currentBaseMap();
    const setCurrentBaseMap = useMapStore.actions.setCurrentBaseMap();
    const layerManager = useLayerStore.state.layerManager();
    const terrainEnabled = useCesiumStore.state.terrainEnabled();
    const setTerrainEnabled = useCesiumStore.getState().setTerrainEnabled;
    const theme = useAppSettingsStore((s) => s.theme);

    useEffect(() => {
        if (currentBaseMap) return;
        // 사용자가 설정(⚙)에서 지정한 기본 배경지도가 있으면 우선 — 단, 그 값이 지금 스키마의
        // 실제 옵션 중 하나일 때만(예전에 고른 키가 스키마 변경으로 사라졌을 수 있음).
        const preferred = useAppSettingsStore.getState().defaultBaseMap;
        const preferredValid = preferred && fields.some(f => f.key === preferred);
        // defaultBaseMap을 한 번도 명시적으로 안 고른 경우(=null)에만 UI 테마에 맞춰 다크면
        // 'midnight'(VWorld 야간지도)를 시도 — 사용자가 이미 명시적으로 고른 배경지도는
        // 테마 토글과 무관하게 절대 안 바뀌어야 한다(배경지도는 UI 크롬과 별개의 독립적인
        // 선택이므로 강제 동기화하지 않음, 최초 1회 스마트 기본값만). 라이트 테마는 별도 로직
        // 없이 기존 basic 그대로 — "라이트용 전용 스타일"이 스키마에 따로 있는지는 서버 쪽
        // basic 플래그가 이미 담당하는 영역이라 프론트에서 이중으로 추측하지 않는다.
        const themeDefault = (!preferred && theme === 'dark')
            ? fields.find(f => f.key === 'midnight')?.key
            : undefined;
        const initialBaseMap = (preferredValid ? preferred : undefined)
            ?? themeDefault
            ?? fields.find(field => field.basic)?.key
            ?? undefined;
        if (initialBaseMap) setCurrentBaseMap(initialBaseMap);
    }, [setCurrentBaseMap, fields, theme]);

    const handleSelect = (layerName: BaseMapType) => {
        // 'naver'는 OL 레이어가 아니라 별도 지도(useNaverBaseMap이 currentBaseMap==='naver'로 활성).
        //   → showLayer 호출 안 함. currentBaseMap만 바꾸면 네이버 훅이 켜지고 OL baseMap은 훅이 숨김.
        if (layerName !== 'naver' && layerManager && layerName) {
            layerManager.showLayer("baseMap", layerName);
        }
        setCurrentBaseMap(layerName);
    };

    // 네이버 위성 항목을 배경지도 목록에 추가 (API 키 있을 때만). OL 스키마 밖의 별도 배경.
    const naverAvailable = !!process.env.REACT_APP_NAVER_MAP_CLIENT_ID;
    const allFields = naverAvailable
        ? [...fields, { key: 'naver', label: '네이버 위성지도', formType: 'radio' } as LayerField]
        : fields;

    return (
        <div>
            <label className={styles.layerItem}>
                <input
                    type="checkbox"
                    checked={terrainEnabled}
                    onChange={(e) => setTerrainEnabled(e.target.checked)}
                />
                지형
            </label>
            <div className={styles.sectionDivider} />
            {allFields.map(field => (
                <label key={field.key} className={styles.layerItem}>
                    <input
                        type={field.formType}
                        name="baseMap"
                        value={field.key}
                        checked={currentBaseMap === field.key}
                        onChange={() => handleSelect(field.key)}
                    />
                    {field.label}
                </label>
            ))}
        </div>
    );
};

export default BaseMap;
