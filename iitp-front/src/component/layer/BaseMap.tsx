import React from 'react';
import { BaseMapType, useMapStore } from '@stores/useMapStore';
import { LayerField } from "@stores/useLayerSchemaStore";
import { useLayerStore } from "@stores/useLayerStore";
import { useCesiumStore } from "@stores/useCesiumStore";
import styles from "@css/ToolsPanel.module.css";

export interface Props {
    fields: LayerField[];
}

// 초기 선택("한 번도 안 고른 경우 defaultBaseMap → 테마 기본값 → 서버 basic" 순 폴백)과
// 테마 실시간 반영은 useBaseMapThemeSync.ts(App.tsx 루트, 상시 마운트)가 전담한다 — 이 컴포넌트
// 자체는 ⚙ 레이어 설정 팝업의 "배경지도" 탭을 열어야만 마운트되는데, 그 로직이 여기 있으면
// 탭을 연 적 없는 사용자는 테마를 토글해도 지도가 안 바뀌는 버그가 생긴다(실사용 보고: "지도가
// 지도탭을 열어야지만 반영됨"). 이 컴포넌트는 목록 렌더링 + 사용자의 명시적 클릭 처리만 한다.
const BaseMap = ({ fields }: Props) => {
    const currentBaseMap = useMapStore.state.currentBaseMap();
    const setCurrentBaseMap = useMapStore.actions.setCurrentBaseMap();
    const setBaseMapFollowsTheme = useMapStore.actions.setBaseMapFollowsTheme();
    const layerManager = useLayerStore.state.layerManager();
    const terrainEnabled = useCesiumStore.state.terrainEnabled();
    const setTerrainEnabled = useCesiumStore.getState().setTerrainEnabled;

    const handleSelect = (layerName: BaseMapType) => {
        // 사용자가 이 세션에서 직접 배경지도를 골랐다 — 그 뒤로는 테마 토글이 절대 안 건드린다.
        setBaseMapFollowsTheme(false);
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
