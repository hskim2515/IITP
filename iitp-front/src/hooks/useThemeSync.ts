import { useEffect } from "react";
import { useAppSettingsStore } from "@stores/useAppSettingsStore";

/** useAppSettingsStore.theme을 document.documentElement의 data-theme 속성에 반영한다 —
 *  src/styles/theme.css의 :root[data-theme="light"] 셀렉터가 이 속성을 읽는다.
 *  index.html의 인라인 스크립트가 첫 페인트 전에 이미 같은 값을 미리 세팅해두므로(FOUC 방지),
 *  이 훅은 이후 사용자가 토글할 때 그 값을 갱신하는 역할이다. */
export function useThemeSync(): void {
    const theme = useAppSettingsStore((s) => s.theme);
    useEffect(() => {
        document.documentElement.dataset.theme = theme;
    }, [theme]);
}
