import React, { useEffect, useRef } from 'react';
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

    // true인 동안은 지금 배경지도가 "테마를 따라가는 중"(사용자가 이 세션에서 직접 고른 적 없음).
    // handleSelect에서 사용자가 직접 클릭하면 false로 내려가 그 뒤로는 테마 토글이 절대 배경지도를
    // 건드리지 않는다 — defaultBaseMap(⚙ 설정의 영구 기본값)과는 별개로, "이번 세션에서 방금
    // 명시적으로 고른 값"까지 존중하기 위한 세션 한정 플래그.
    const followsThemeRef = useRef(true);

    const applyThemeBaseMap = (nextTheme: 'dark' | 'light') => {
        // 'midnight'(야간지도)/'white'(백지도)는 database/layer.sql의 baseMap 필드 — 스키마
        // 마이그레이션이 아직 안 된 환경(구 DB)에는 없을 수 있어 없으면 basic 필드로 폴백.
        const target = nextTheme === 'dark'
            ? fields.find(f => f.key === 'midnight')?.key ?? fields.find(f => f.basic)?.key
            : fields.find(f => f.key === 'white')?.key ?? fields.find(f => f.basic)?.key;
        if (!target) return;
        if (layerManager) layerManager.showLayer("baseMap", target);
        setCurrentBaseMap(target);
    };

    useEffect(() => {
        if (currentBaseMap) return;
        // 사용자가 설정(⚙)에서 지정한 기본 배경지도가 있으면 우선 — 단, 그 값이 지금 스키마의
        // 실제 옵션 중 하나일 때만(예전에 고른 키가 스키마 변경으로 사라졌을 수 있음).
        const preferred = useAppSettingsStore.getState().defaultBaseMap;
        const preferredValid = preferred && fields.some(f => f.key === preferred);
        if (preferredValid) {
            followsThemeRef.current = false;
            setCurrentBaseMap(preferred);
            return;
        }
        // defaultBaseMap을 한 번도 명시적으로 안 고른 경우(=null)에만 테마를 따라간다 —
        // 다크는 'midnight', 라이트는 'white'(둘 다 VWorld).
        followsThemeRef.current = true;
        applyThemeBaseMap(theme);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setCurrentBaseMap, fields]);

    // 마운트 이후 테마가 바뀔 때: defaultBaseMap이 없고(=서버 기본값 사용 중) 이번 세션에서
    // 사용자가 아직 배경지도를 직접 고르지 않았을 때만 실시간으로 따라간다. defaultBaseMap을
    // 명시적으로 설정했거나 이번 세션에 직접 고른 경우는 테마 토글과 무관하게 그대로 둔다
    // (배경지도는 UI 크롬과 별개의 독립적인 선택이라는 원래 설계 원칙 유지, 다만 "테마를 따라가는
    // 중"인 동안은 실시간으로 반응하도록 확장 — 사용자 요청: "지도도 vworld 화이트모드
    // 지도로해주고").
    useEffect(() => {
        if (!followsThemeRef.current) return;
        const preferred = useAppSettingsStore.getState().defaultBaseMap;
        if (preferred) return;
        applyThemeBaseMap(theme);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [theme]);

    const handleSelect = (layerName: BaseMapType) => {
        followsThemeRef.current = false;
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
