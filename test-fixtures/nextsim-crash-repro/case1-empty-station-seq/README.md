# Case 1 — 정류장 없는 버스 노선(`station.seq=""`) → NextSim SIGSEGV

## 증상

버스 노선(`roadPTline.xml`의 `<Line>`)의 `station.seq`가 빈 문자열이면(그 노선에
정류장이 하나도 안 걸려있으면) `nextsim` 바이너리가 시뮬레이션 초기화 도중
확정적으로(터미널 조합과 무관하게) SIGSEGV로 죽는다.

이미 `NEXTSIM_DATA_STRUCTURE.md`의 `roadPTline.xml` 섹션에 문서화된
"정류장 없는 노선 크래시"와 동일한 결함이다. `OsmFacilityConverter.convertBusRoutes()`는
이 조건(`stationSeq.isEmpty()`)이면 애초에 노선 자체를 생성 결과에서 제외해서
이 크래시를 피하는데, **수동으로 노선을 만들거나(그리드/API 직접 호출) 정류장
재스냅이 전부 실패해 station.seq가 빈 채로 남는 경로에서는 이 안전장치를
안 거치므로 재현될 수 있다.**

## 실측 에러 로그(2026-07-30, scenario2_1)

```
Error: Cannot build OD map for line 1. RoadLinks or RoadStations is empty.
Error: Cannot build OD map for line 1. RoadLinks or RoadStations is empty.
===============================================================================
/root/NextSim/Captain/Tests/UnitTestsSimulation/Tests.cpp:39:
TEST CASE:  Simulation

/root/NextSim/Captain/Tests/UnitTestsSimulation/Tests.cpp:39: FATAL ERROR: test case CRASHED: SIGSEGV - Segmentation violation signal
```

## 부수 효과 — 크래시 복구 이분탐색 예산 낭비

이 크래시는 `NextSimRunner.TerminalNodeCrashException`으로 잡혀 크래시 복구
이분탐색(`resolveChunk`)에 진입하는데, 원인이 터미널 조합과 무관하므로
**어떤 조합을 시도해도 항상 재현되어 이분탐색이 100% 실패로 끝나며 예산
(최대 `MAX_CRASH_RECOVERY_ATTEMPTS`=600회)만 낭비한다.** 2026-07-30 세션에서
추가한 `NextSimRunner.tryPtIsolationRetry()`(버스 노선을 비우고 1회 재시도)도
이 케이스를 감지는 하지만(노선이 있으므로 절연 시도는 발동함), 재시도가
성공하면 노선 제외로 진행되고, 실패하면(다른 원인과 뒤섞인 경우) 원상복구 후
이분탐색으로 넘어간다 — 이 케이스 단독으로는 절연 재시도가 정확히 원인을
잡아 회피할 것으로 예상되지만, 이 fixture로는 아직 재검증하지 않았다(원본
발견은 station.seq="" + 다른 재임포트 네트워크 조합에서 있었음).

## 재현 데이터

`NextSimRunner.stageInputs()`가 실제로 읽는 시나리오 버전 로컬 모델
디렉터리(`~/.iitp-local/models/{versionId}/`)의 **필수 파일 전체**를
담았다 — 아래 8개만 있으면 재현 가능하다(`mode.xml`/`config_scenario.json`/
`param.xml`/`vehicletypes.xml`/`recordMode.xml`/`outputmetrics.xml`/
`backgroundTraffic.xml`/`events.xml`/`config.txt`는 실행 시점에
`NextSimRunner`가 자동 생성/배포판에서 복사하므로 이 폴더에 없어도 된다).

- `network.xml` — 강남역 인근 좁은 bbox(south=37.488, west=127.020,
  north=37.508, east=127.040)로 KTDB 재임포트한 소규모 네트워크
  (375노드/449링크). 재현에 필요한 유일한 이유는 "터미널 노드 4개짜리
  경로"가 존재한다는 것뿐 — 이 결함은 네트워크 규모와 무관하게 재현된다.
- `roadPTline.xml` — 터미널↔터미널 유효 경로(4링크: `20000467 20000465
  20000468 20000470`, 문서에 이미 기록된 "4링크·6링크 둘 다 문제"의 4링크
  케이스와 동일 길이)이지만 **`station.seq`가 빈 문자열**.
- `roadStation.xml` — 정류장 없음(이 결함 재현에 정류장 존재 여부 자체는
  무관 — 핵심은 station.seq 값).
- `odmatrix.xml`(demand 442건)/`signal.xml`(노드 64개)/`signalTOD.xml`/
  `passenger.xml`(승객 수요 없음)/`scenario.xml` — 위 `network.xml`과
  노드/링크 id 정합 확인 완료(source/sink·signal 노드 전부 network에 존재).

## 재현 절차

1. 위 8개 파일을 시나리오 버전의 로컬 모델 디렉터리
   (`~/.iitp-local/models/{versionId}/`)에 복사.
2. `POST /simulation/{versionId}/run` 호출.
3. 수 분 내(크래시 자체는 각 시도당 빠르게 판정됨) 이분탐색이 전부 실패로
   끝나며 `state=ERROR`, 위 에러 로그가 `error` 필드에 포함됨.

## 올바른 수정 방향(미착수)

- `OsmFacilityConverter.convertBusRoutes()`가 이미 하는 `station.seq` 빈
  노선 제외 로직을 **수동 편집 저장 경로**(그리드/`BusPtLineController`
  저장)에도 적용하거나, `PtLineValidation`에 이 조건을 추가해 저장 시점에
  경고하는 방안을 검토할 것.
