import { useEffect } from "react";
import { useAppSettingsStore } from "@stores/useAppSettingsStore";
import { useLayerSchemaStore } from "@stores/useLayerSchemaStore";
import { useLayerStore } from "@stores/useLayerStore";
import { useMapStore } from "@stores/useMapStore";

/**
 * 배경지도를 앱 테마에 맞춰 골라준다(다크="midnight"/라이트="white") — App.tsx 루트에서
 * 한 번만 호출해 앱 생명주기 내내 상시 구독한다.
 *
 * 예전엔 이 로직이 BaseMap.tsx(⚙ 레이어 설정 팝업의 "배경지도" 탭을 열어야만 마운트되는
 * 컴포넌트) 안에서만 useEffect로 동작했다 — 그래서 그 탭을 연 적 없는 사용자는 테마를
 * 토글해도 지도가 안 바뀌었고, 탭을 처음 여는 순간에야 그제서야 반영되는 버그가 있었다
 * (사용자 보고: "지도가 지도탭을 열어야지만 반영됨"). 배경지도는 지도 자체(Cesium/OL)에
 * 속한 전역 상태라, 그걸 다루는 탭이 열려있는지와 무관하게 항상 반응해야 한다.
 */
export function useBaseMapThemeSync(): void {
    const theme = useAppSettingsStore((s) => s.theme);
    const groups = useLayerSchemaStore((s) => s.groups);
    const layerManager = useLayerStore((s) => s.layerManager);

    // currentBaseMap/baseMapFollowsTheme는 의도적으로 deps에서 뺀다 — 이 값들은 이 effect
    // 스스로 setCurrentBaseMap()으로 갱신하므로 deps에 넣으면 자기 자신을 다시 트리거하는
    // 루프가 된다. 매 실행 시 useMapStore.getState()로 항상 최신값을 직접 읽어 stale closure
    // 없이 최신 결정을 내린다 — 재실행 트리거는 오직 theme/groups/layerManager 변경뿐.
    useEffect(() => {
        const baseMapFields = groups.find((g) => g.key === 'baseMap')?.layers;
        if (!baseMapFields || baseMapFields.length === 0) return;

        const { currentBaseMap, baseMapFollowsTheme, setCurrentBaseMap, setBaseMapFollowsTheme } = useMapStore.getState();
        const preferred = useAppSettingsStore.getState().defaultBaseMap;
        const preferredValid = preferred && baseMapFields.some((f) => f.key === preferred);

        if (!currentBaseMap) {
            // 최초 선택 — 사용자가 설정(⚙)에서 지정한 기본 배경지도가 있으면 우선(유효할 때만).
            // 없으면(defaultBaseMap === null, 한 번도 명시적으로 안 고름) 테마를 따라간다.
            if (preferredValid) {
                setBaseMapFollowsTheme(false);
                setCurrentBaseMap(preferred);
                return;
            }
            setBaseMapFollowsTheme(true);
        } else if (!baseMapFollowsTheme || preferred) {
            // 이미 선택된 배경지도가 있고, 사용자가 직접 고른 상태(follows=false)이거나
            // defaultBaseMap이 명시돼 있으면 테마 토글이 절대 건드리지 않는다.
            return;
        }

        const target = theme === 'dark'
            ? baseMapFields.find((f) => f.key === 'midnight')?.key ?? baseMapFields.find((f) => f.basic)?.key
            : baseMapFields.find((f) => f.key === 'white')?.key ?? baseMapFields.find((f) => f.basic)?.key;
        if (!target || target === currentBaseMap) return;

        if (layerManager) layerManager.showLayer("baseMap", target);
        setCurrentBaseMap(target);
    }, [theme, groups, layerManager]);
}
