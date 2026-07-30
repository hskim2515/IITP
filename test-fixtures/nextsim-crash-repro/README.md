# NextSim 크래시 재현 데이터셋 모음

2026-07-30 세션에서 KTDB 재임포트 후 정류장/버스노선 재매핑 기능(link_ref
재스냅, roadPTline.xml 경로 재구성, 크래시 복구 시 버스 노선 절연 재시도)을
실측 검증하는 과정에서 발견/재확인한 NextSim 바이너리 크래시 케이스를
모은다. 각 하위 폴더는 독립적으로 재현 가능한 최소 데이터셋
(`network.xml` + `roadPTline.xml` + `roadStation.xml` 등)과 실측 에러
로그, 재현 절차를 담은 `README.md`를 갖는다.

## 케이스 목록

| 케이스 | 원인 | 상태 |
|---|---|---|
| [case1-empty-station-seq](case1-empty-station-seq/) | 버스 노선의 `station.seq`가 빈 문자열 | ✅ 재현 확인, 원인 확정 |
| [case2-terminal-to-terminal-negative-result](case2-terminal-to-terminal-negative-result/) | 문서화된 "2번 결함"(터미널↔터미널 노선도 크래시) 재현 시도 | ❌ 3~8링크 6개 조합 전부 미재현 — scenario3_1 특정 토폴로지 문제로 추정 |

## 배경 — 왜 이 조사를 했는가

`NEXTSIM_DATA_STRUCTURE.md`의 `roadPTline.xml` 섹션에는 2026-07-27
scenario3_1 조사에서 발견된 두 가지 실측 크래시가 기록돼 있다:

1. 노선 시작/끝이 터미널 노드가 아니면 `route-generator`가
   `PT Route Generation Start` 단계에서 크래시.
2. **터미널↔터미널의 유효한 노선이라도**(4링크·6링크 둘 다) `nextsim`이
   시뮬레이션 사이클 시작 직전 `vector::_M_range_check`로 크래시.

2번 결함 때문에 크래시 복구 이분탐색(터미널 노드 조합을 바꿔가며 재시도)이
노선이 하나라도 있으면 항상 실패해 예산(600회)을 낭비하는 문제가 있어,
`NextSimRunner.tryPtIsolationRetry()`(버스 노선을 비우고 1회 절연 재시도)를
추가했다. 이 절연 재시도 로직이 실제로 2번 결함 상황에서 개입해 성공적으로
우회하는지 실측 검증하기 위해 여러 터미널↔터미널 노선 길이(3~8링크)로
반복 테스트하는 과정에서, 의도치 않게 **case1**(서로 다른 원인의 크래시)을
먼저 발견해 별도 케이스로 분리했다.

**2번 결함(유효한 터미널↔터미널 노선 자체의 크래시)은 이 세션에서
끝내 재현하지 못했다** — 3~8링크 6가지 조합 전부 정상 완주했다(자세한
내용은 [case2](case2-terminal-to-terminal-negative-result/) 참고). 이
결함은 scenario3_1의 특정 네트워크 토폴로지에 국한된 문제일 가능성이
높다.
