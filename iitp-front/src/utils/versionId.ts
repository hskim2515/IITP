import { useScenarioStore } from "@stores/useScenarioStore";

/**
 * 데이터 접근용 단일 식별자(versionId).
 *
 * 백엔드는 API path 의 versionId 를 그대로 파일 디렉토리·DB version_id·타일 캐시 키로
 * 사용한다. 따라서 데이터 로드/렌더/import/시뮬/저장 **모두 동일한 식별자**를 써야
 * 읽기·쓰기가 같은 폴더/레코드를 본다 (버전 격리).
 *
 * 규칙: **version.key 우선** (버전별 격리), 미선택 시 scenario.key 로 안전 폴백.
 * App 이 scenario → 버전 선택을 강제하므로 대체로 version.key 가 보장된다.
 *
 * ⚠️ 이 함수는 "데이터 접근 식별자"만 반환한다. scenario 고유 속성
 *    (longitude/latitude 지도 초기 위치, id 버전목록 조회)은 selectedScenario 에서 직접 읽을 것.
 */
export function getActiveVersionId(): string | undefined {
    const s = useScenarioStore.getState();
    const key = s.selectedScenarioVersion?.key ?? s.selectedScenario?.key ?? undefined;
    if (key != null && s.selectedScenarioVersion?.key == null && s.selectedScenario?.key != null) {
        // 버전 미선택 → scenario.key 폴백 (정상 흐름에선 드묾)
        console.warn("[versionId] 버전 미선택 → scenario.key 폴백:", s.selectedScenario?.key);
    }
    return key != null ? String(key) : undefined;
}
