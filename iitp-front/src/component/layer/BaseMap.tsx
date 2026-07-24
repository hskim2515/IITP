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

    useEffect(() => {
        if (currentBaseMap) return;
        // 사용자가 설정(⚙)에서 지정한 기본 배경지도가 있으면 우선 — 단, 그 값이 지금 스키마의
        // 실제 옵션 중 하나일 때만(예전에 고른 키가 스키마 변경으로 사라졌을 수 있음). 없으면
        // 서버 스키마의 basic 필드로 폴백(예전 동작 그대로).
        const preferred = useAppSettingsStore.getState().defaultBaseMap;
        const preferredValid = preferred && fields.some(f => f.key === preferred);
        const initialBaseMap = (preferredValid ? preferred : undefined)
            ?? fields.find(field => field.basic)?.key
            ?? undefined;
        if (initialBaseMap) setCurrentBaseMap(initialBaseMap);
    }, [setCurrentBaseMap, fields]);

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
