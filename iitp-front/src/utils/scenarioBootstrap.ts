import { Scenario, ScenarioVersions } from "@type/Scenario";

/**
 * 헤더에서 "버전 변경"/"데이터 초기화"를 하면 전역 store·레이어·타일 캐시가 세션에 누적된
 * 상태라(Header.tsx의 goHome 주석과 동일 이유) 안전하게 되돌리려면 전체 페이지 리로드가
 * 필요하다. 다만 useScenarioStore(selectedScenario/selectedScenarioVersion)는 미영속이라
 * 그냥 리로드하면 시나리오 선택 화면(홈)으로 튕겨나간다 — 리로드 직전에 목표 시나리오/버전을
 * sessionStorage에 잠깐 적어두고, App 마운트 시 이를 읽어 자동으로 그 시나리오/버전으로
 * 복원한다(홈 화면을 거치지 않고 바로 재진입).
 */
const KEY = "iitp:pendingScenario";

export function stashPendingScenario(scenario: Scenario, version: ScenarioVersions): void {
    try {
        sessionStorage.setItem(KEY, JSON.stringify({ scenario, version }));
    } catch (_) { /* 스토리지 불가(시크릿 모드 등) — 리로드 후 홈으로 폴백 */ }
}

/** 대기 중인 목표가 있으면 반환하며 즉시 소비(제거) — 두 번 적용되지 않도록. */
export function consumePendingScenario(): { scenario: Scenario; version: ScenarioVersions } | null {
    try {
        const raw = sessionStorage.getItem(KEY);
        if (!raw) return null;
        sessionStorage.removeItem(KEY);
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

/** 초기화/버전변경 등으로 안전하게 재진입하기 위한 리로드 — 대상을 stash 후 새로고침. */
export function reloadIntoScenario(scenario: Scenario, version: ScenarioVersions): void {
    stashPendingScenario(scenario, version);
    window.location.reload();
}
