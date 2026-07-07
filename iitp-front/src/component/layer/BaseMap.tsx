import React, { useEffect } from 'react';
import { BaseMapType, useMapStore } from '@stores/useMapStore';
import { LayerField } from "@stores/useLayerSchemaStore";
import { useLayerStore } from "@stores/useLayerStore";
import styles from "@css/ToolsPanel.module.css";

export interface Props {
    fields: LayerField[];
}

const BaseMap = ({ fields }: Props) => {
    const currentBaseMap = useMapStore.state.currentBaseMap();
    const setCurrentBaseMap = useMapStore.actions.setCurrentBaseMap();
    const layerManager = useLayerStore.state.layerManager();

    useEffect(() => {
        if (currentBaseMap) return;
        const initialBaseMap = fields.find(field => field.basic)?.key || undefined;
        if (initialBaseMap) setCurrentBaseMap(initialBaseMap);
    }, [setCurrentBaseMap]);

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
