# NextSim Input/Output 데이터 구조 정리

## 빠른 목차

구분:

| 표시 | 의미 |
|---|---|
| 필수 | 기본 시뮬레이션 실행에 필요 |
| 필수에 가까움 | 현재 배포판 구조상 함께 사용하는 것이 안전 |
| 생성 필요 | 사용자가 직접 작성하기보다 `generate_routes.sh`로 생성하는 파생 입력. `run_sim.sh` 실행 시점에는 존재해야 함 |
| 조건부 | 대중교통, 철도, 승객, 보행 등 해당 기능 사용 시 필요 |
| 선택 | 없어도 기본 실행은 가능하지만 특정 시나리오나 초기조건에 사용 |

- [입력 경로와 설정 방법](#input-path)
- [DB 파일 설명](#db-file-summary)
- [ID 네이밍/채번 규칙](#id-naming)
- [데이터 변경 영향 매트릭스](#impact-matrix)
- [Input 데이터](#input-data)
  - [`SimulationInput/config.txt` 필수](#config-txt)
  - [`parameter_xml` 공통 파라미터 폴더](#parameter-xml-folder)
  - [`param.xml` 선택](#param-xml)
  - [`vehicletypes.xml` 선택](#vehicletypes-xml)
  - [`recordMode.xml` 선택](#recordmode-xml)
  - [`outputmetrics.xml` 선택](#outputmetrics-xml)
  - [`network_xml_{network_name}` 네트워크 입력 폴더](#network-xml-folder)
  - [`network.xml` 필수](#network-xml)
  - [`mode.xml` 필수](#mode-xml)
  - [`scenario.xml` 필수](#scenario-xml)
  - [`config_scenario.json` 필수](#config-scenario-json)
  - [`odmatrix.xml` 필수](#odmatrix-xml)
  - [`Route.json` 생성 필요](#route-json)
  - [`signal.xml` 필수](#signal-xml)
  - [`signalTOD.xml` 필수](#signaltod-xml)
  - [`passenger.xml` 선택](#passenger-xml)
  - [`PaxRoute.json` 조건부 생성 필요](#paxroute-json)
  - [`PTRoute.json` 생성 필요](#ptroute-json)
  - [`roadPTline.xml` 조건부](#roadptline-xml)
  - [`roadStation.xml` 조건부](#roadstation-xml)
  - [`railPTline.xml` 조건부](#railptline-xml)
  - [`railStation.xml` 조건부](#railstation-xml)
  - [`footpathNetwork.xml` 조건부](#footpathnetwork-xml)
  - [`backgroundTraffic.xml` 선택](#backgroundtraffic-xml)
  - [`events.xml` 선택](#events-xml)
- [Output 데이터](#output-data)
  - [`SimulationInfo.xml`](#simulationinfo-xml)
  - [`Vehicle.json`](#vehicle-json)
  - [`simulation_output.db`](#simulation-output-db)
- [SQLite DB 테이블](#simulation-output-db)
  - [`VehicleInfo`](#vehicleinfo)
  - [`VehicleEvent`](#vehicleevent)
  - [`VehicleEventDebugging`](#vehicleeventdebugging)
  - [`VehicleStatistics`](#vehiclestatistics)
  - [`VehicleLinkStatistics`](#vehiclelinkstatistics)
  - [`CellEvent`](#cellevent)
  - [`PaxEvent`](#paxevent)
  - [`StationEvent`](#stationevent)
  - [`SinkEvent`](#sinkevent)
  - [`SignalControlEvent`](#signalcontrolevent)

---

<a id="input-path"></a>

## 입력 경로와 설정 방법

NextSim의 입력 데이터는 기본적으로 `SimulationInput` 폴더 아래에 둔다.

현재 예제 기준 입력 경로는 다음과 같다.

```text
SimulationInput/
 ├─ config.txt
 └─ datasets/
     └─ mesopt/
         ├─ parameter_xml/
         │   ├─ param.xml
         │   ├─ vehicletypes.xml
         │   ├─ recordMode.xml
         │   └─ outputmetrics.xml
         └─ network_xml_iitp/
             ├─ network.xml
             ├─ scenario.xml
             ├─ odmatrix.xml
             ├─ signal.xml
             ├─ signalTOD.xml
             ├─ mode.xml
             ├─ Route.json
             └─ ...
```

`config.txt`는 NextSim(외부 바이너리) 입장에서 실제 사용할 네트워크 폴더를 지정하는 파일이다.

```text
network_name=iitp
branch=mesopt
```

위 설정은 다음 경로를 의미한다.

```text
SimulationInput/datasets/mesopt/network_xml_iitp/
```

즉 규칙은 다음과 같다.

```text
SimulationInput/datasets/{branch}/network_xml_{network_name}/
```

> ⚠️ **`network_name`/`branch`는 config.txt를 직접 편집해서 바꾸는 값이 아니다**: 우리 백엔드(`NextSimRunner.java`)가 매 실행마다 `network_name=iitp`/`branch=mesopt`를 하드코딩된 Java 상수(`NETWORK_NAME`/`BRANCH`)로 config.txt를 통째로 새로 써버린다(`stageInputs()`). 즉 config.txt는 NextSim 실행 시점에 우리 쪽에서 생성하는 산출물이지, 사용자가 편집해 다른 네트워크를 가리키게 하는 설정 파일이 아니다 — 현재 시스템은 항상 `network_xml_iitp/` 하나만 스테이징한다. (참고로 `network_xml_bucheon/`은 KAIST 부천 레퍼런스 데이터셋이 배포판에 참조용으로 남아있는 별개 고정 경로이며, railPTline.xml 등 일부 파일의 폴백 복사 원본으로만 쓰인다.) 실제로 새 네트워크(`network_name`)를 추가하려면 `NextSimRunner.java`의 `NETWORK_NAME`/`BRANCH` 상수를 고치고 백엔드를 다시 빌드/배포해야 한다.

공통 파라미터 파일은 branch 아래의 `parameter_xml` 폴더를 사용한다.

```text
SimulationInput/datasets/{branch}/parameter_xml/
```

단, `Route.json`, `PTRoute.json`, `PaxRoute.json`은 일반적으로 직접 작성해서 넣는 원천 데이터가 아니라, `network.xml`, `odmatrix.xml`, 대중교통/승객 관련 입력을 준비한 뒤 `generate_routes.sh`로 생성하는 파생 입력 파일이다.

```bash
./scripts/generate_routes.sh
./scripts/generate_routes.sh --with-pax
```

---

<a id="db-file-summary"></a>

## DB 파일 설명

`simulation_output.db`는 **차량 루트 파일이 아니라 시뮬레이션 결과 파일**이다.

NextSim 실행 후 생성되는 SQLite 데이터베이스 파일이며, 차량의 시간별 위치, 속도, 링크/셀 상태, 승객 이벤트, 정류장 이벤트, 통행시간, 지체시간 같은 결과 데이터가 저장된다.

차량 경로 입력 파일은 별도로 존재한다.

```text
입력 차량 경로: SimulationInput/.../Route.json
출력 결과 DB:   SimulationOutput/simulation_output.db
```

즉 역할은 다음처럼 구분하면 된다.

| 파일 | 역할 |
|---|---|
| `Route.json` | 시뮬레이션 전에 차량이 따라갈 경로 입력 |
| `PTRoute.json` | 시뮬레이션 전에 대중교통 노선 경로 입력 |
| `PaxRoute.json` | 시뮬레이션 전에 승객 경로 입력 |
| `simulation_output.db` | 시뮬레이션 후 생성되는 결과 DB |
| `Vehicle.json` | 시뮬레이션 후 생성되는 차량 요약 결과 |
| `SimulationInfo.xml` | 시뮬레이션 후 생성되는 실행 정보 |

---

<a id="id-naming"></a>

## ID 네이밍/채번 규칙

노드/링크 등 네트워크 요소의 id는 **8자리 정수 대역**으로 타입을 구분한다. 이 대역을 벗어나거나 섞이면 NextSim route-generator가 `std::out_of_range`(빈 vector/맵 인덱싱)로 크래시하므로, 여러 실측 사례에서 반복 확인된 만큼 반드시 지켜야 한다.

### 네트워크 요소 (KTDB/OSM 도로망 임포트 공통 — `NetworkIdAssigner.java`)

| 타입 | 대역 | 채번 규칙 |
|---|---|---|
| Link | `20,000,000 ~` | `20_000_000 + 순번` |
| 일반 Node | `10,000,000 ~ 10,999,999` | `10_000_000 + 순번` (Link와 카운터를 공유, 외부 링크 스캔 순서대로 배정) |
| Terminal(출발/도착 전용 노드) | `11,000,000 ~ 11,999,999` | 연결된 유일한 Link id의 뒷자리 3자리를 그대로 파생(예: Link `20000326` ↔ Terminal `11000326`), 충돌 시 순번 폴백 |
| Garage(버스/트램 차고지) | `12,000,000 ~ 12,999,999` | 채번하지 않고 원본 id 그대로 보존 — 과거 이 구분이 없어 Garage를 Normal로 오인해 인덱스가 크게 어긋난 실측 버그가 있었음 |

`NetworkIdNormalizer.java`(수동편집 저장 시), `OdTerminalIdBandService.java`(OD 대역 재정합)도 같은 대역 체계를 공유한다.

### 대중교통 시설물 (OSM 자동 스냅 — `OsmFacilityConverter.java`)

| 타입 | 대역 | 비고 |
|---|---|---|
| 버스 정류장 | `30,000,001 ~` | |
| 철도역 + 출입구(exit) | `31,000,001 ~` | **역과 출입구가 하나의 카운터를 공유**한다 |

> ⚠️ **실측 크래시(scenario2_1)**: 철도역 id를 채번한 뒤 `idGen.get()`으로 출입구 id를 "훔쳐보기만" 하고 카운터를 소비하지 않으면, 바로 다음 루프의 역 id가 같은 값을 또 써서 출입구 id와 충돌한다 — NextSim route-generator가 이 id를 키로 맵을 구성하다 `std::out_of_range`로 크래시했다(railStation.xml의 exit 85개 전부가 다른 역의 id와 겹치는 형태로 재현). 반드시 `getAndIncrement()`로 소비할 것.
>
> 이 문서의 `railStation.xml` 예시(`id="40000001"`)는 KAIST 부천 레퍼런스 데이터셋에서 가져온 값이고, **현재 자동생성 코드가 실제로 배정하는 대역은 31M**이다 — 40M대는 강제되는 규칙이 아니라 그 레퍼런스 데이터셋만의 값이니 새 규칙으로 오인하지 말 것.

### 수동 그리기 (`useNetworkDraw.ts`)

프론트엔드에서 새로 그린 노드/링크는 `Date.now()`(13자리 타임스탬프)를 그대로 id로 쓴다 — 위 8자리 대역과 무관하다. **저장(diff merge) 시점에 백엔드(`NetworkIdNormalizer`)가 8자리 규칙으로 전면 재채번**한다. 링크 분할(`splitLinkInNetwork`)은 타임스탬프 `ts`에 `+10/+11/+12` 오프셋을 더해 같은 그리기 세션 내 충돌을 피한다.

### KTDB 원본 id 보존

KTDB 원본 `node_id`/`link_id`(문자열)는 위 규칙으로 재채번되며 그 자체로는 버려진다. 대신 `origId`(원본 id 해시)를 별도 필드로 남겨 **TURNINFO(회전정보) 매칭에만** 쓴다 — 재채번된 `id()`로 TURNINFO를 조회하면 안 된다.

### 하위 요소(lane/cell/segment/connection/turn)

부모 요소 안에서 **0부터 시작하는 로컬 순번**이다. 전역 8자리 대역과 무관하다 — 예: `lane id="0"`, `cell id="0"`, `connection id="0"`은 그 링크/노드 안에서만 유일하면 된다.

### id 타입(number vs string)

백엔드는 전부 `Long`이라 JSON 직렬화 시 number로 온다. 다만 프론트 수동편집의 `Date.now()` 타임스탬프(매우 큰 정수)가 섞이면서 프론트 타입은 `number | string` 유니언으로 되어 있다 — **Map 키로 쓸 때는 항상 `String()`으로 통일**할 것(number/string 타입 불일치로 조회가 조용히 실패하는 사고가 반복 확인됨).

### ID가 바뀔 때(재임포트 등) 반드시 갱신해야 하는 것

- `network.xml`: link/node id, from_node/to_node, port의 link_id, connection의 from_link/to_link
- `odmatrix.xml`: source/sink — `OdTerminalIdBandService`가 자동으로 재정합하고, 노드 삭제 시 해당 demand를 자동 삭제(prune)
- `signal.xml`/`signalTOD.xml`: node id, connectionId — 참조가 안 맞으면 `NextSimInputScaffolder`가 signal.xml 전체를 재생성하거나 connectionId만 null로 초기화
- 버스/철도 정류장(`roadStation.xml`/`railStation.xml`)·PT 노선(`roadPTline.xml`/`railPTline.xml`): KTDB 재임포트 확인 시 앱 설정의 `busFacilityEnabled`/`railFacilityEnabled`가 켜져 있으면 OSM에서 새로 가져와 새 네트워크에 재스냅한 뒤 **자동 저장(기존 데이터 덮어쓰기)**된다(`OsmFacilityConverter` → `FileImportModal.tsx`의 `injectAll`+`autoSaveChangedLayers`) — link_ref/lane_ref/link seq/node seq/railStationSeq는 이 과정에서 자동으로 맞춰진다. **단, 수동으로 추가·편집한 정류장/노선도 이때 통째로 덮어써져 사라진다** — 보존하려면 이 토글을 꺼야 한다. 토글을 꺼서 재임포트해도(또는 대형망 스트리밍 경로처럼 OSM 조회가 아예 없을 때도) **정류장/역의 link_ref/lane_ref는 저장된 좌표 기준으로 자동 재스냅되고**(`KtdbImportController.resnapExistingStationsIfNeeded` — id·이름 등은 그대로 유지), **`roadPTline.xml`의 버스 노선 link/node seq도 그 노선이 지나는 정류장들(이미 재스냅된 linkRef)을 waypoint 삼아 자동으로 재구성된다**(`KtdbImportController.remapStaleBusRoutes` → `OsmFacilityConverter.remapBusRouteByStationAnchors`) — 위상이 너무 크게 바뀌어 정류장 사이를 못 이으면(또는 정류장 2개 미만) 그 노선만 재매핑 실패로 남고 나머지는 정상 갱신된다. 철도 노선(`railPTline.xml`)은 애초에 link/node id가 아니라 `railStationSeq`(정류장 id, 재임포트로 안 바뀌는 안정적 네임스페이스)만 참조해 재매핑이 필요 없다.
- 포장 노면표시(`linkRef`/`laneRef`/`cellId`): NextSim 시뮬레이션 입력이 아니라 시각화 보조 데이터라 백엔드 검증·재매핑 로직 자체가 없다. **네트워크 재임포트 시엔 문제없음** — `backupAndResetDependentLayers`가 재임포트 직전 기존 노면표시를 서버에서 통째로 삭제하고(끊어진 참조가 남는 게 아니라 데이터가 사라짐), OSM/KTDB 둘 다 이후 `generateAndSaveDummyPavementMarking`으로 새 네트워크 기준 재생성한다(앱 설정 `pavementMarkingEnabled` 토글). Link/Node/Port 삭제(지도 툴·그리드 공통)는 정류장과 동일하게 `deletePavementMarkingsForLinks`로, Link는 안 지우고 numLane만 줄이는 경우(필드 수정·그리드 Lane 행 삭제)는 `deletePavementMarkingsForShrunkLanes`로 cascade 정리된다.
- station/garage id는 재임포트로 안 바뀌는 별도 네임스페이스라 `PtLineValidation`의 검증 대상에서 제외됨(id 자체는 안정적, 위 링크 참조만 문제가 됨)

---

<a id="impact-matrix"></a>

## 데이터 변경 영향 매트릭스

> ⚠️ **가장 중요한 전제**: 네트워크를 편집하는 경로가 **두 가지**이고, 두 경로 다 동일한 `useNetworkSelect.ts`의 순수 함수(`batchDeleteOrMergeNodes`/`deleteLinkFromNetwork`/`reconcileSignalConnectionIds`/`deleteStationsForLinks` 등)를 재사용해 캐스케이드를 보장한다.
> - **지도 툴 경로**(`NetworkEditToolbar.tsx`/`LinkContextMenu.tsx`): 삭제·이동 시 자동 캐스케이드가 폭넓게 구현되어 있다.
> - **속성 그리드 경로**(`DrilldownGrid.tsx`의 `handleDelete`/`handleAdd`): 레인/커넥션/포트 같은 하위 레벨 삭제·추가는 자체 캐스케이드가 있고, Node/Link를 그리드 최상위 레벨에서 삭제하는 경우도 지도 툴과 동일한 캐스케이드 함수를 호출하도록 수정됨(과거엔 캐스케이드가 전혀 없어 참조 무결성이 깨진 채로 저장되는 위험한 경로였음).

### 네트워크 구조 (Node/Link/Lane/Connection/Port)

| 대상 | 작업 | 경로 | 연쇄되는 것 | 자동/수동 |
|---|---|---|---|---|
| Node | 삭제(통과노드 아님: in/out 포트 구성이 병합 조건 불충족) | 지도 툴 | 연결된 모든 Link cascade 삭제 → Signal의 connectionId 정리 → 그 노드의 Signal 자체 삭제 → 사라진 Link 위 정류장 삭제 → 타일 마스킹 | ✅ |
| Node | 삭제(통과노드: in/out 각 1개, 양쪽 차선수 동일) | 지도 툴 | Link cascade 삭제 대신 앞뒤 Link를 하나로 병합 | ✅ |
| Node | 삭제 (그리드 최상위 레벨에서 직접) | 속성 그리드 | 지도 툴과 동일: 연결 Link cascade 삭제/병합, Signal connectionId 정리·삭제, 정류장 삭제, 타일 마스킹 | ✅ (`handleRootNetworkDelete` — 지도 툴 캐스케이드 함수 재사용) |
| Node | 좌표 이동(드래그) | 지도 툴 | 연결 Link 끝점 좌표·길이 재계산, Lane cells/segments 비율 재조정, Connection 좌표 평행이동 | ✅ (좌표만) |
| Node | 좌표 이동 후 신호 재계산 | — | 방위각 기반 신호 페어링은 자동 재계산되지 않는다 — "화면 내 더미 신호 생성"을 별도로 다시 눌러야 함 | ❌ 수동 |
| Node | 병합(교차로 정리 도구) | 지도 툴 | self-loop Link 자동 제거, ports/connections 병합. 단 병합된 Connection의 좌표는 빈 배열로 리셋되어 재계산 필요 | ⚠️ 부분 자동 |
| Link | 삭제 | 지도 툴 | 양끝 Node의 ports(link_id 일치)·connections(from_link/to_link 일치) 필터링 + numPort/numConnection 재동기화 | ✅ |
| Link | 삭제 (그리드 최상위 레벨에서 직접) | 속성 그리드 | 지도 툴과 동일: 양끝 Node의 ports/connections 정리, Signal connectionId 정리, 정류장 삭제, 타일 마스킹 | ✅ (`handleRootNetworkDelete` — 지도 툴 캐스케이드 함수 재사용) |
| Link | 방향 반전 | 지도 툴 | 포트 in/out은 자동으로 뒤집히지만, 관련 Connection은 **삭제만 하고 재생성하지 않는다** | ⚠️ 부분 자동 — 반전 후 커넥션 직접 재작업 필요 |
| Link.numLane 감소 | 필드 수정 | 속성 그리드 | 사라진 레인(index ≥ 새 numLane)을 참조하던 Connection 삭제 → 그 connectionId를 쓰던 Signal의 connectionId를 null로 초기화 | ✅ |
| Link.length | 필드 수정 | 속성 그리드 | 그 Link의 Lane들의 cells/segments를 비율로 재조정 | ✅ |
| Lane | 그리드에서 행 추가 | 속성 그리드 | 부모 Link의 numLane을 실제 배열 길이로 재동기화. id는 부모 레인 배열의 다음 순번으로 자동 배정(fromLane/toLane 참조 정합 유지) | ✅ |
| Lane | 그리드에서 행 직접 삭제 | 속성 그리드 | 부모 Link의 numLane 재동기화 + 사라진 레인을 참조하던 Connection 삭제 + 그 Connection을 쓰던 Signal의 connectionId 정리 | ✅ (numLane 필드 편집과 동일 결과) |
| Connection | 그리드에서 행 추가 | 속성 그리드 | 부모 Node의 numConnection을 실제 배열 길이로 재동기화 | ✅ |
| Connection | 그리드에서 행 삭제 | 속성 그리드 | 부모 Node의 numConnection 재동기화 + 그 connectionId를 쓰던 Signal의 connectionId 정리 | ✅ |
| Port | 그리드에서 행 추가 | 속성 그리드 | 부모 Node의 numPort를 실제 배열 길이로 재동기화. **linkId는 임의값이라 실제 존재하는 링크로 수동 지정 필요** | ⚠️ 부분 자동 — 저장 시 경고 문구: "포트가 추가되었습니다. ⚠ linkId를 실제 존재하는 링크로 지정해야 유효합니다." |
| Port | 그리드에서 행 삭제 | 속성 그리드 | 포트가 가리키던 Link를 지도 툴 링크 삭제와 동일하게 cascade 삭제(양끝 Node ports/connections 정리, Signal connectionId 정리, 정류장 삭제, 타일 마스킹) | ✅ (포트 삭제 = 참조 Link 삭제로 취급) |
| 네트워크 저장(diff) | — | — | 저장 API(`NetworkTileService.applyDiff`)는 id 기준 순수 upsert/delete만 수행하고 참조 무결성 검증·캐스케이드를 전혀 하지 않는다 — **위 캐스케이드는 전부 클라이언트(프론트) 책임**이며, 캐스케이드 없이 저장된 데이터는 서버에 그대로 반영된다 | ⚠️ 클라이언트 책임 |

### 신호 (Signal / SignalTOD)

| 상황 | 연쇄되는 것 | 자동/수동 |
|---|---|---|
| 네트워크 재임포트(id 전면 교체) | signal.xml의 node 참조가 새 네트워크에 없으면 전체 재생성(더미 신호 생성기 재사용, 방위각 기반 페어링) | ✅ (`NextSimInputScaffolder`) |
| Signal이 재생성됨 | signalTOD.xml도 무조건 같이 재생성 | ✅ |
| Signal은 유효한데 TOD 커버리지만 빠짐(수동 편집 등) | 빠진 노드만 기본 TOD로 채움 | ✅ (`repairSignalTod`) |
| Connection이 삭제되어 connectionId가 무효해짐 | Signal 자체는 유지한 채 connectionId만 null로 초기화 | ✅ (`reconcileSignalConnectionIds`) |
| 수동 편집으로 마주보지 않는 접근로가 같은 현시에 배정됨 | 저장 전 상충 경고(저장을 막지는 않음) | ⚠️ 경고만, 강제 차단 없음 |
| TOD의 두 플랜 시간대가 겹침 | 저장 전 경고(저장을 막지는 않음) | ⚠️ 경고만 |

### OD 매트릭스

| 상황 | 연쇄되는 것 | 자동/수동 |
|---|---|---|
| 네트워크 재임포트로 source/sink id가 새 터미널 집합과 안 맞음 | 거리 감쇠 기반 샘플 수요로 전체 재생성(앱 설정에서 flow 범위/기준거리 조정 가능) | ✅ (`NextSimInputScaffolder`) |
| 노드 삭제(그 노드가 source/sink로 쓰이던 경우) | 해당 demand 항목 자동 삭제(prune) | ✅ (`OdTerminalIdBandService`) |

### 버스/철도 정류장·PT 노선

| 상황 | 연쇄되는 것 | 자동/수동 |
|---|---|---|
| KTDB 네트워크 재임포트(앱 설정 `busFacilityEnabled`/`railFacilityEnabled` 켜짐, 기본값) | OSM에서 새로 정류장/노선을 가져와 새 네트워크에 재스냅 후 자동 저장 — `roadStation.xml`/`railStation.xml`/`roadPTline.xml`/`railPTline.xml` 전부 **덮어쓰기** | ✅ (`OsmFacilityConverter` → `FileImportModal.tsx`) — 단 **수동으로 추가·편집한 정류장/노선도 이때 같이 사라짐** |
| KTDB 네트워크 재임포트(위 토글 꺼짐, 또는 대형망 스트리밍 경로처럼 OSM 조회 자체가 없는 경우) | 정류장/역 자체(id·이름·부가정보)는 그대로 두고, 저장돼 있던 좌표(center/exit.coord)를 새 네트워크에 재스냅해 `link_ref`/`lane_ref`만 자동 갱신 | ✅ (`OsmFacilityConverter.resnapByLocalCoord` → `KtdbImportController.resnapExistingStationsIfNeeded`) — 재스냅 실패(좌표가 새 네트워크에서 50m 밖)한 정류장은 NextSim이 link_ref를 필수로 요구해 유지가 불가능하므로 제외됨(로그로 개수 확인 가능) |
| OSM 재조회 실패(Overpass 타임아웃 등) | 위와 동일한 재스냅 경로를 탄다(`fac`가 비어있는 것으로 취급) | ✅ 위와 동일 |
| roadPTline.xml의 버스 노선 link/node seq(정류장 link_ref가 아니라 **노선 전체 경로**) | 그 노선이 지나는 정류장들(이미 재스냅된 linkRef)을 waypoint 삼아 위상 경로를 다시 이어 붙여 재구성 | ✅ (`OsmFacilityConverter.remapBusRouteByStationAnchors` → `KtdbImportController.remapStaleBusRoutes`) — 정류장 2개 미만이거나 정류장 사이 경로 연결이 안 되면(위상이 크게 바뀜) 그 노선만 재매핑 실패로 남아 수동 재작업 필요, 나머지 노선은 정상 갱신됨. 이번 요청에서 OSM으로 노선을 새로 가져온 경우(토글 켜짐)는 건너뜀(위 행에서 이미 덮어씀) |
| railPTline.xml의 철도 노선 | link/node id가 아니라 `railStationSeq`(정류장 id)만 참조 — 정류장 id는 재임포트로 안 바뀌는 안정적 네임스페이스라 애초에 재매핑이 필요 없음 | ✅ 원래부터 문제없음 |

### 그 외 알려진 갭 (자동 처리 없음)

| 대상 | 상황 | 대응 |
|---|---|---|
| 포장 노면표시(linkRef/laneRef/cellId) | 네트워크 재임포트(OSM/KTDB) | 재임포트 전 기존 데이터 전체 삭제(`backupAndResetDependentLayers`) 후 새 네트워크 기준으로 재생성(`generateAndSaveDummyPavementMarking`, `pavementMarkingEnabled` 토글) | ✅ |
| 포장 노면표시(linkRef/laneRef/cellId) | Link/Node/Port 삭제(지도 툴·그리드 공통) | 정류장과 동일하게 `deletePavementMarkingsForLinks`로 cascade 삭제 | ✅ |
| 포장 노면표시(linkRef/laneRef/cellId) | Link는 유지한 채 numLane만 감소(필드 수정·일괄 수정·그리드 Lane 행 삭제) | 사라진 레인을 참조하는 노면표시를 `deletePavementMarkingsForShrunkLanes`로 cascade 삭제 | ✅ |

---

<a id="input-data"></a>

# Input 데이터

NextSim 입력은 크게 두 묶음으로 나뉜다.

폴더별 구성:

```text
SimulationInput/config.txt

parameter_xml/
 - param.xml
 - vehicletypes.xml
 - recordMode.xml
 - outputmetrics.xml

network_xml_{network_name}/
 - network.xml
 - mode.xml
 - scenario.xml
 - config_scenario.json
 - odmatrix.xml
 - signal.xml
 - signalTOD.xml
 - Route.json
   - generate_routes.sh로 생성
   - 차량 시뮬레이션 실행 시점에는 필요
 - PTRoute.json
   - generate_routes.sh로 생성
   - 대중교통 노선 사용 시 필요
 - PaxRoute.json
   - generate_routes.sh --with-pax로 생성
   - 승객/대중교통/보행 경로 사용 시 필요
 - passenger.xml
 - roadPTline.xml
 - roadStation.xml
 - railPTline.xml
 - railStation.xml
 - footpathNetwork.xml
 - backgroundTraffic.xml
 - events.xml
```

<a id="parameter-xml-folder"></a>

## `parameter_xml` 공통 파라미터 폴더

경로:

```text
SimulationInput/datasets/{branch}/parameter_xml/
```

역할: 시뮬레이션 공통 파라미터, 차종, 기록 모드, 출력 지표 설정을 담는 폴더다.

현재 확인 기준으로 `parameter_xml` 아래 파일들은 모두 **선택 설정 파일**로 본다. 파일이 있으면 해당 설정을 명시적으로 적용하고, 없으면 바이너리 내부 기본값 또는 기본 동작으로 실행될 수 있다.

포함 파일:

```text
param.xml
vehicletypes.xml
recordMode.xml
outputmetrics.xml
```

<a id="network-xml-folder"></a>

## `network_xml_{network_name}` 네트워크 입력 폴더

경로:

```text
SimulationInput/datasets/{branch}/network_xml_{network_name}/
```

예:

```text
SimulationInput/datasets/mesopt/network_xml_iitp/
```

역할: 특정 네트워크에 대한 도로망, 수요, 신호, 시나리오, 대중교통, 승객, 경로 파일을 담는 폴더다.

이 폴더의 원천 입력 파일을 바탕으로 `generate_routes.sh`가 `Route.json`, `PTRoute.json`, `PaxRoute.json` 같은 경로 파일을 생성하고, `run_sim.sh`가 시뮬레이션 결과를 생성한다.

주의:

```text
odmatrix.xml
  - 차량 수요 입력 파일
  - 없으면 차량 투입 수요가 없어 DB 결과가 비거나 의미 없는 결과가 될 수 있음

Route.json
  - 사용자가 직접 작성하는 원천 파일은 아님
  - generate_routes.sh로 생성하는 파생 입력
  - run_sim.sh 실행 시점에는 존재해야 차량이 경로를 따라 이동할 수 있음
```

<a id="config-txt"></a>

## `SimulationInput/config.txt` [필수]

필수

역할: NextSim(외부 바이너리) 입장에서 사용할 네트워크 데이터셋을 지정한다.

구조:

```text
network_name=iitp
branch=mesopt
```

필드:

| 필드 | 설명 |
|---|---|
| `network_name` | 사용할 네트워크 이름 |
| `branch` | 사용할 데이터셋/모델 분기 |

> ⚠️ 이 파일은 사용자가 편집하는 설정 파일이 아니라 **매 실행마다 `NextSimRunner.java`가 하드코딩된 `NETWORK_NAME="iitp"`/`BRANCH="mesopt"` 상수로 새로 써버리는 산출물**이다. 자세한 내용은 [입력 경로와 설정 방법](#input-path)의 경고 참고.

---

<a id="network-xml"></a>

## `network.xml` [필수]

필수

역할: 도로 네트워크 본체. 노드, 링크, 차로, 셀, 연결 정보를 포함한다.

계층구조:

```text
Network
 ├─ nodes
 │   └─ node
 │       ├─ port
 │       └─ connection
 └─ links
     └─ link
         ├─ lane
         │   ├─ cell
         │   └─ segment
         └─ section
```

주요 속성:

| 요소 | 속성 |
|---|---|
| `Network` | `id` |
| `node` | `id`, `type`, `v2x`, `num_port`, `num_connection`, `center`, `name`(옵셔널, 표준노드링크 NODE_NAME 유래) |
| `port` | `type`, `direction`, `link_id` |
| `connection` | `id`, `from_link`, `from_lane`, `to_link`, `to_lane`, `turning`, `length`, `width`, `ff_spd`, `shape` |
| `link` | `id`, `from_node`, `to_node`, `num_lane`, `length`, `width`, `min_spd`, `max_spd`, `ff_spd`, `wave_spd`, `qmax`, `max_veh`, `sim_type`, `type`, `stop_line`, `shape`, `name`(옵셔널, 표준노드링크 ROAD_NAME 유래), `layer` |
| `lane` | `id`, `num_cell`, `left_lane_id`, `right_lane_id`, `lane_access_type`, `right_lc`, `left_lc`, `shape` |
| `cell` | `id`, `length`, `offset` |
| `segment` | `id`, `block`, `init_point`, `end_point`, `left_lc`, `right_lc` |
| `section` | `id`, `length`, `offset`, `slope`, `left_id`, `right_id` |

> ⚠️ `node`에는 `x_coord`/`y_coord` 속성이 없다 — 좌표는 `center`(공백 구분 "lat lng" 문자열) 하나로만 표현되며, 백엔드 `NodeXml.java`의 `Coordinates coordinates` 필드는 `@XmlTransient`라 XML로 직렬화되지 않는다(예시의 `<node ... center="..."/>`가 실제 출력과 일치, x_coord/y_coord는 예전 표기가 잘못 남은 것).

예시:

```xml
<node id="10000421" type="intersection" num_port="4" num_connection="5" center="12.7708 -125.5703"/>
<link id="20000402" from_node="10000507" to_node="11000402" num_lane="4" length="90.71" max_spd="50.0" qmax="1800.0"/>
<lane id="0" num_cell="2" left_lane_id="None" right_lane_id="1"/>
<cell id="0" length="69.44" offset="0"/>
```

---

<a id="mode-xml"></a>

## `mode.xml` [필수]

필수

역할: 링크별 시뮬레이션 방식을 지정한다. `micro` 또는 `meso` 링크 목록을 가진다.

계층구조:

```text
Periods
 └─ period
     ├─ micro
     └─ meso
```

주요 속성:

| 요소 | 속성 |
|---|---|
| `period` | `id`, `stime` |
| `micro` | `linkid` |
| `meso` | `linkid` |

예시:

```xml
<period id="1" stime="0">
  <micro linkid=" " />
  <meso linkid="20000402 20000403 20000404 ..." />
</period>
```

---

<a id="scenario-xml"></a>

## `scenario.xml` [필수]

필수

역할: 시뮬레이션 시나리오를 정의한다.

계층구조:

```text
Scenarios
 └─ Scenario
```

주요 속성:

| 요소 | 속성 |
|---|---|
| `Scenario` | `id`, `startTime`, `duration`, `BGTduration`, `odMatrixID`, `todID`, `signalControl` |

예시:

```xml
<Scenario id="0" startTime="06:00:00" duration="60" BGTduration="0" odMatrixID="0" todID="0" signalControl="False"/>
```

---

<a id="config-scenario-json"></a>

## `config_scenario.json` [필수]

필수

역할: 시나리오별 교통센터, 신호제어, V2X 설정을 정의한다.

구조:

```text
Scenarios[]
 ├─ id
 ├─ startTime
 ├─ duration
 ├─ BGTduration
 ├─ odMatrixID
 ├─ todID
 └─ trafficCenter
     ├─ signalControl
     │   ├─ active
     │   └─ interval
     └─ v2x
         ├─ active
         └─ interval
```

이 파일은 사람이 직접 쓰는 게 아니라 `NextSimRunner.java`의 `writeConfigScenarioJson()`이 `scenario.xml`을 파싱해 그대로 미러링해서 생성한다. `signalControl.active`/`v2x.active`는 **현재 항상 `false`로 하드코딩**된다(scenario.xml에 해당 값이 없어서가 아니라 미러링 코드 자체가 고정값을 씀 — 시나리오별로 다르게 켜고 끄는 기능은 아직 없음).

예시(실제 생성 결과):

```json
{
    "Scenarios": [
        {
            "id": 0,
            "startTime": "06:00:00",
            "duration": 60,
            "BGTduration": 0,
            "odMatrixID": 0,
            "todID": 0,
            "trafficCenter": {
                "signalControl": { "active": false, "interval": 1.0 },
                "v2x": { "active": false, "interval": 1.0 }
            }
        }
    ]
}
```

---

<a id="odmatrix-xml"></a>

## `odmatrix.xml` [필수]

필수

> ⚠️ **재임포트 시 id 정합 필수**: `source`/`sink`는 각각 out포트 전용/in포트 전용 터미널 id 집합(위 [ID 네이밍/채번 규칙](#id-naming) 참고)에 전부 존재해야 유효하다. 네트워크를 재임포트해 id가 전면 교체되면 `NextSimInputScaffolder`가 이 유효성을 검사해 안 맞으면 거리 감쇠 기반 샘플 수요로 자동 재생성한다(방향이 뒤집혀도 낡음으로 처리) — 앱 설정(⚙ → 자동생성 설정)에서 flow 범위/기준거리 조정 가능.

역할: 차량 OD 수요를 정의한다.

계층구조:

```text
Demands
 └─ odMatrix
     ├─ avodMatrix
     └─ nvodMatrix
         └─ demand
```

주요 속성:

| 요소 | 속성 |
|---|---|
| `odMatrix` | `id`, `startTime`, `duration` |
| `demand` | `source`, `sink`, `flow`, `dist` |

> `avodMatrix`는 현재 코드(`NextSimInputScaffolder.java`)에서 항상 빈 자기닫힘 태그(`<avodMatrix/>`)로만 써진다 — AV 전용 수요 등 실제 콘텐츠가 들어가는 경로는 아직 없다. 실제 수요 데이터는 전부 `nvodMatrix/demand`에만 들어간다.

예시:

```xml
<demand source="11000403" sink="11000404" flow="33" dist=""/>
```

---

<a id="route-json"></a>

## `Route.json` [생성 필요]

생성 필요  
사용자가 직접 작성하는 파일이라기보다 `generate_routes.sh` 실행으로 생성/갱신하는 차량 경로 입력 파일이다.

역할: 차량이 따라갈 사전 계산 경로를 정의한다.

구조:

```text
Route[]
 ├─ OriginID
 ├─ DestinationID
 ├─ RouteID
 ├─ Preference
 ├─ Cost
 ├─ Distance
 └─ Route[]
```

예시:

```json
{
  "OriginID": 11000403,
  "DestinationID": 11000402,
  "RouteID": 0,
  "Preference": "Distance",
  "Cost": 1878.95,
  "Distance": 1878.95,
  "Route": ["11000403", "20000403 1 0.1", "100005073 2 0.2", "11000402"]
}
```

---

<a id="signal-xml"></a>

## `signal.xml` [필수]

필수

> ⚠️ **재임포트 시 id 정합 필수 + 자동생성 시 상충 검사**: `node`의 `id`는 참조 노드가 하나라도 새 네트워크 노드 집합에 없으면 낡은 것으로 보고 `NextSimInputScaffolder`가 전체 재생성한다(더미 신호 생성기 재사용). 더미 신호 자동생성은 마주보는 접근로끼리만 동시 녹색으로 묶는 방위각 기반 페어링을 쓰고, 수동으로 turn/connList를 편집할 때도 같은 기준으로 "마주보지 않는 접근로가 동시 녹색이 되는" 상충을 경고한다.
>
> ⚠️ **허용오차(`signalOppositeBearingToleranceDeg`) 설정은 백엔드 자동생성에는 적용되지 않는다**: 앱 설정(⚙ → 자동생성 설정)의 이 값은 **프론트엔드**(`iitp-front/src/utils/signal.ts`의 `generateDummySignals`/화면 내 더미 신호 생성 버튼·OSM 임포트 경로, 그리고 수동 편집 상충 검사)에만 적용된다. **KTDB 재임포트 시 백엔드가 실제로 최종 저장하는 signal.xml**은 `NextSimInputScaffolder` → `DummySignalGenerator.java`의 `OPPOSITE_BEARING_TOLERANCE_DEG = 30`(하드코딩) 상수를 쓰며, 이 설정값을 전달받지 않는다 — 즉 설정을 바꿔도 KTDB로 재임포트한 네트워크의 최종 신호 페어링에는 반영되지 않는다.

역할: 교차로 신호 plan, phase, turn 정보를 정의한다.

계층구조:

```text
Signal
 └─ node
     ├─ turnList
     │   └─ turn
     └─ planList
         └─ plan
             └─ phase
```

주요 속성:

| 요소 | 속성 |
|---|---|
| `node` | `id` |
| `turn` | `id`, `type`, `turning`, `connList` |
| `plan` | `id`, `cycle`, `offset` |
| `phase` | `id`, `duration`, `turnList`, `minGreenTime`(옵셔널), `maxGreenTime`(옵셔널) |

예시:

```xml
<plan id="0" cycle="200" offset="0"/>
<phase id="0" duration="34" turnList="11 12 0 4 6 10" minGreenTime="15" maxGreenTime="40"/>
<turn id="0" turning="R" type="RTOR" connList="11"/>
```

`minGreenTime`/`maxGreenTime`는 `DummySignalGenerator.java`가 signal.xml을 생성할 때만 채워지고(더미 생성기 전용 로직), 수동으로 만든 phase에는 없을 수 있다(옵셔널). 과거엔 `SignalXml.PhaseXml`/`SignalResponse.PhaseData` 모델에 이 필드가 아예 없어 프론트 신호 그리드에서 한 번이라도 저장하면 조용히 드롭되는 갭이 있었는데, 두 모델 + `SignalService.toSignalXml`/`fromSignalXml` 라운드트립에 필드를 추가해 수정 완료.

---

<a id="signaltod-xml"></a>

## `signalTOD.xml` [필수]

필수

> ⚠️ **signal.xml의 plan 보유 노드를 전부 커버해야 함**: 하나라도 빠지면(플랜은 있는데 TOD 항목이 없는 노드) NextSim이 "지금 어느 플랜을 써야 하는지" 조회에 실패해 `std::out_of_range`로 크래시한다(실측 확인). `signal.xml`이 재생성되면 signalTOD.xml도 무조건 같이 재생성되고, signal.xml 자체는 유효해도 TOD 커버리지만 빠진 경우엔(수동 편집 등) 그 데이터에 맞는 기본 TOD로 부족한 부분만 채운다(`NextSimInputScaffolder.repairSignalTod`). 노드가 평시(plan 0)/혼잡(plan 1) 두 플랜을 다 가지면 출퇴근 러시아워(07~09시, 17~19시)엔 혼잡 플랜을 쓰는 기본 스케줄을 만든다.

역할: 시간대별 신호 plan 적용 정보를 정의한다.

계층구조:

```text
TOD
 └─ node
     └─ plan
```

주요 속성:

| 요소 | 속성 |
|---|---|
| `node` | `id` |
| `plan` | `id`, `startTime`, `endTime` |

예시:

```xml
<plan id="0" startTime="00:00:00" endTime="09:00:00"/>
```

---

<a id="param-xml"></a>

## `param.xml` [선택]

선택  
`parameter_xml` 폴더에 두는 공통 파라미터 설정 파일이다.

역할: 시뮬레이션 기본 파라미터를 정의한다.

계층구조:

```text
param
 ├─ meso
 │   ├─ max_flow
 │   ├─ veh_len
 │   └─ wave_speed
 └─ simParam
     ├─ micro_time_step
     ├─ meso_time_step
     ├─ yellow_signal
     ├─ BCFMinKeepTime
     ├─ DCFKeepTime
     ├─ CCFKeepTime
     └─ ACFKeepTime
```

주요 속성:

| 요소 | 속성 |
|---|---|
| `max_flow` | `value` |
| `veh_len` | `value` |
| `wave_speed` | `value` |
| `micro_time_step` | `value` |
| `meso_time_step` | `value` |
| `yellow_signal` | `value` |

예시:

```xml
<micro_time_step value="0.1"/>
<meso_time_step value="5.0"/>
<yellow_signal value="2.0"/>
```

---

<a id="vehicletypes-xml"></a>

## `vehicletypes.xml` [선택]

선택  
`parameter_xml` 폴더에 두는 차종별 주행 특성 설정 파일이다.

역할: 차종별 주행 특성을 정의한다.

계층구조:

```text
VehType_Scenario
 └─ vehtype
     ├─ veh_len
     ├─ veh_width
     ├─ jamgap
     ├─ vf
     ├─ reaction_time
     ├─ max_acc
     ├─ max_dec
     ├─ lc_param1
     ├─ lc_param2
     └─ lc_sensitivity
```

주요 속성:

| 요소 | 속성 |
|---|---|
| `vehtype` | `id`, `max_pax`, `name`, `v2x` |
| 주행 파라미터 | `dist`, `min`, `max`, `mean`, `sd` |

차종 예:

```text
NormalVeh
AutonomousVeh
Truck
NormalBus
AutonomousBus
TRT
```

> ⚠️ **실측 확인된 전역 회귀 (2026-07-27)**: `NextSimRunner.buildVehicleTypesXml()`가 "교통수단
> 유형" 편집 화면의 한글 이름(예: "택시", "버스")을 `name` 속성에 그대로 썼었다. NextSim 엔진은
> "Initializing NB/AB/TRT" 단계에서 vehtype 목록을 위 6개 **정식 카테고리 이름**으로 조회하는데,
> 이름이 일치하지 않으면 에러 없이 "Complete: Initializing Public Transit" 직후 출력 없이 CPU
> 100%로 무한 행(hang)한다 — 버스/철도 작업과 무관하게 이번 세션의 **모든** 시나리오에서
> 재현된 전역 회귀였다(예: scenario1_1 — 이 세션에서 전혀 건드리지 않은 시나리오도 포함).
> `veh_width` 속성 누락도 배포판 예시와의 또 다른 차이점이었다. `vehicle_type.nextsim_type_code`
> (NV/AV/NB/AB/TRK/TR/TRUCK)로 6개 정식 카테고리에 매핑하고, 매핑 없는 카테고리는 배포판
> 기본값을 채우도록 수정 완료 — `NextSimRunner.java`의 `REQUIRED_VEHTYPE_NAMES`/
> `CODE_TO_CANONICAL_NAME`/`DEFAULT_VEHTYPE_BODY` 참고.

예시:

```xml
<vehtype id="0" max_pax="0" name="NormalVeh" v2x="off">
  <veh_len dist="Normal" max="5.5" mean="5.0" min="4.5" sd="0.5"/>
  <vf dist="Normal" max="60.0" mean="50.0" min="45.0" sd="10.0"/>
</vehtype>
```

---

<a id="recordmode-xml"></a>

## `recordMode.xml` [선택]

선택  
`parameter_xml` 폴더에 두는 이벤트 기록 설정 파일이다.

역할: 어떤 이벤트를 기록할지 정의한다.

계층구조:

```text
RecordModes
 ├─ VehicleEvent
 │   ├─ Debugging
 │   ├─ Visualizer
 │   └─ Statistics
 ├─ PassengerEvent
 ├─ UniformEvent
 ├─ StationEvent
 ├─ SinkEvent
 ├─ SignalEvent
 └─ SignalControlEvent
```

주요 속성:

| 요소 | 속성 |
|---|---|
| 이벤트 요소 | `active` |

예시(`NextSimRunner.java`가 매 실행마다 덮어쓰는 실제 값 — 배포판 템플릿과 무관하게 항상 이 값으로 고정):

```xml
<RecordModes>
    <VehicleEvent>
        <Debugging active="f" />
        <Visualizer active="t" />
        <Statistics active="t" />
    </VehicleEvent>
    <PassengerEvent active="t" />
    <UniformEvent active="f" />
    <StationEvent active="t" />
    <SinkEvent active="t" />
    <SignalEvent active="f" />
    <SignalControlEvent active="f" />
</RecordModes>
```

> `Debugging`/`UniformEvent`는 백엔드가 소비하지 않는(미사용) 기록이라 항상 꺼둔다(대규모 네트워크에서 시뮬 쓰기 부하·결과 DB 크기 폭증 방지) — `param.xml`/`outputmetrics.xml`과 달리 이 파일은 배포판 템플릿을 그대로 복사하는 게 아니라 이 코드가 항상 덮어쓴다.

---

<a id="outputmetrics-xml"></a>

## `outputmetrics.xml` [선택]

선택  
`parameter_xml` 폴더에 두는 출력 지표 설정 파일이다.

역할: 출력할 성능지표를 정의한다.

계층구조:

```text
OutputMetrics
 ├─ SimulationEvent
 ├─ VehicleEvent
 ├─ UniformEvent
 ├─ StationEvent
 └─ SinkEvent
```

주요 지표:

```text
run_time
run_time_per_step
spd
density
flow
harmonic_spd
avg_travel_time
delay_time
mean_queue
arrival_time
dpt_time
dwell_time
count
travel_time
```

예시:

```xml
<UniformEvent>
  <spd output="t"/>
  <density output="t"/>
  <flow output="t"/>
  <mean_queue output="t"/>
</UniformEvent>
```

---

<a id="passenger-xml"></a>

## `passenger.xml` [선택]

선택  
승객 시뮬레이션 사용 시 필요

역할: 승객 OD 수요를 정의한다.

계층구조:

```text
Passenger
 └─ od_pax
     └─ demand
```

주요 속성:

| 요소 | 속성 |
|---|---|
| `demand` | `origin`, `dest`, `dist`, `flow` |

예시:

```xml
<demand origin="30011458" dest="30011463" dist="Poisson" flow="60"/>
```

---

<a id="paxroute-json"></a>

## `PaxRoute.json` [조건부 생성 필요]

조건부 생성 필요  
승객 경로 사용 시 필요하며, `generate_routes.sh --with-pax` 실행으로 생성/갱신한다.

> ⚠️ **양쪽 방향 다 실측 크래시 확인됨(`NextSimRunner.java`)**: 대중교통 노선/정류장이 하나라도 있으면 시뮬레이션 엔진이 이 파일을 무조건 참조한다 — 파일 자체가 없으면 `vector::_M_range_check: __n=0 >= size=0`(빈 vector 인덱싱)으로 즉시 크래시(scenario3_1, 버스 노선 추가 후 재현). 그렇다고 승객 OD 수요가 없는데도 `pax-route-generator`를 무조건 돌리면, 전체 정류장 쌍에 대해 경로를 계산하려다 호스트 메모리를 전부 써버리고 OOMKilled된다. 그래서 **승객 수요(`hasPassengerDemand`, `passenger.xml`의 `<demand>` 존재 여부)가 있을 때만 실제로 생성**하고, 없으면 스키마만 맞는 빈 stub(`{"PaxRoute": []}`)을 직접 써서 파일 부재로 인한 크래시만 막는다(계산 비용 0, OOM 위험 없음). `generate_routes.sh --with-pax`도 이 옵션을 기본 OFF로 두는 것과 같은 이유다. `footpathNetwork.xml`도 정확히 이 조건과 짝을 맞춰야 한다([해당 절](#footpathnetwork-xml) 참고).

역할: 승객 경로 후보를 정의한다.

구조:

```text
PaxRoute[]
 ├─ OriginID
 ├─ DestinationID
 └─ Routes[]
     ├─ Preference
     ├─ SubtripVector[]
     │   ├─ Mode
     │   ├─ SubtripID
     │   ├─ SubtripOrigin
     │   ├─ SubtripDest
     │   ├─ LineIDs
     │   └─ SubtripTime
     ├─ Fare
     ├─ TransferCount
     └─ RouteTime
```

예시:

```json
{
  "OriginID": 30011458,
  "DestinationID": 30011459,
  "Routes": [
    {
      "Preference": "Time",
      "SubtripVector": [
        { "Mode": "Walking", "SubtripID": 0, "SubtripOrigin": 30011458, "SubtripDest": 30011459, "LineIDs": [], "SubtripTime": 5.23 }
      ],
      "Fare": 0.0,
      "TransferCount": 0,
      "RouteTime": 5.23
    }
  ]
}
```

---

<a id="ptroute-json"></a>

## `PTRoute.json` [생성 필요]

생성 필요  
사용자가 직접 작성하는 파일이라기보다 `generate_routes.sh` 실행으로 생성/갱신하는 대중교통 노선 경로 입력 파일이다.

역할: 대중교통 노선이 따라갈 경로를 정의한다.

구조:

```text
Route[]
 ├─ LineID
 ├─ OriginID
 ├─ DestinationID
 └─ Route[]
```

예시:

```json
{
  "LineID": "Bus11-2_out",
  "OriginID": 11000585,
  "DestinationID": 11001454,
  "Route": ["11000585", "20000585 5 2.3.4.5", "11001454"]
}
```

---

<a id="roadptline-xml"></a>

## `roadPTline.xml` [조건부]

선택  
버스 사용 시 필요

> ⚠️ **실측 확인된 NextSim 바이너리 결함/제약 (2026-07-27, scenario3_1)**: 실제 버스 노선(1개
> 노선, 정류장 2개)을 넣고 실행하면 위상(토폴로지)에 따라 아래 문제가 재현된다. 우리 쪽 XML
> 변환/스테이징 코드 문제가 아니라 NextSim 자체(`route-generator`/`nextsim` 바이너리, 소스
> 미접근)의 결함으로 판단됨.
> 1. 노선의 시작/끝 링크가 실제 네트워크 **터미널 노드**가 아니면 `route-generator`가
>    `PT Route Generation Start` 단계에서 `std::out_of_range: _Map_base::at`로 크래시.
> 2. 터미널↔터미널 노선(짧은 4링크·긴 6링크 둘 다)이라도 `nextsim`이 시뮬레이션 사이클을
>    시작하기 직전(Recording & Routes 초기화 직후) `vector::_M_range_check`로 크래시.
>
> **주의 — 최초 조사 당시엔 별개 오류로 보였던 세 번째 증상(6링크일 때 크래시 대신 CPU 100%
> 무한 행)은 사실 [`vehicletypes.xml` 회귀 버그](#vehicletypes-xml)의 증상이었다.** 그 버그를
> 고친 뒤 동일 6링크 구성을 재실행하면 행 없이 훨씬 더 진행되어(Public Transit → Vehicle
> Demand → Passenger Demand → Events → Recordings까지) 2번 증상과 동일한 지점에서 크래시한다
> — 즉 실제 남은 버스 노선 결함은 위 두 가지뿐이며, 그마저도 원래 알려진 것보다 범위가 좁을
> 수 있다(재조사 필요). fee/interval/use_ptlane 값, station 유무·위치, garage 노드 회피 여부는
> 결과에 영향 없음.
>
> 버스 파이프라인의 나머지(SFTP 동기화·경로 캐시·PaxRoute.json 처리)는 모두 정상 동작 확인됨
> (`NextSimRunner.java`, `BusPtLineController`/`BusStationService`).

역할: 버스 노선을 정의한다.

계층구조:

```text
Lines
 └─ Line
     └─ links
         └─ link
```

주요 속성:

| 요소 | 속성 |
|---|---|
| `Lines` | `mode` |
| `Line` | `id`, `fee`, `interval` |
| `link` | `id`, `seq`, `station`, `use_ptlane` |

예시:

```xml
<Line id="Bus66_out" fee="1550" interval="10">
  <links>
    <link id="20000499" seq="0" use_ptlane="False"/>
  </links>
</Line>
```

---

<a id="roadstation-xml"></a>

## `roadStation.xml` [조건부]

선택  
버스 사용 시 필요

> ⚠️ **id는 30M 대역, 재임포트 시 기본적으로 자동 재생성(덮어쓰기)됨**: `station.id`는 OSM 자동 스냅 시 `30,000,001`부터 채번된다([ID 네이밍/채번 규칙](#id-naming) 참고). KTDB 네트워크를 재임포트하면 앱 설정의 `busFacilityEnabled`가 켜져 있는 한(기본값) `OsmFacilityConverter`가 OSM에서 정류장을 새로 가져와 새 네트워크에 맞게 `link_ref`/`lane_ref`를 다시 스냅하고, 그 결과가 자동으로 저장된다(`FileImportModal.tsx`의 `injectAll`+`autoSaveChangedLayers`) — 즉 link_ref/lane_ref는 수동 재스냅 없이 자동으로 맞춰진다. **다만 이 과정은 기존 `roadStation.xml`을 통째로 덮어쓰므로, 수동으로 추가·편집한 정류장은 재임포트할 때마다 조용히 사라진다.** 수동 편집분을 보존하려면 재임포트 전 `busFacilityEnabled`를 꺼야 하는데, 이 경우에도 기존 정류장(id·이름 등 유지)의 `link_ref`/`lane_ref`는 저장된 좌표를 새 네트워크에 재스냅해 자동으로 갱신된다(`KtdbImportController.resnapExistingStationsIfNeeded` → `OsmFacilityConverter.resnapByLocalCoord`) — 좌표가 새 네트워크에서 50m 밖으로 벗어난 경우에만(도로가 아예 없어진 경우) 재스냅이 실패해 그 정류장이 제외된다.

역할: 버스 정류장을 정의한다.

계층구조:

```text
PublicTransit
 └─ Stations
     └─ station
         └─ line
```

주요 속성:

| 요소 | 속성 |
|---|---|
| `station` | `id`, `link_ref`, `lane_ref`, `pos`, `center`, `parkingLots` |
| `line` | `list` |

예시:

```xml
<station id="30011458" link_ref="20000573" lane_ref="3" pos="91.02" parkingLots="2" center="-44.0079 6.4152"/>
```

---

<a id="railptline-xml"></a>

## `railPTline.xml` [조건부]

선택  
철도 사용 시 필요

> ⚠️ 아래 예시의 `stationSeq id="40000001"`은 KAIST 부천 레퍼런스 데이터셋 값이다 — 현재 자동생성되는 철도역 id 대역은 `31,000,001`부터다([ID 네이밍/채번 규칙](#id-naming) 참고). KTDB 재임포트 시 앱 설정 `railFacilityEnabled`가 켜져 있으면(기본값) `link seq`/`node seq`/`railStationSeq`는 OSM 재조회 기반으로 노선 전체가 자동 재생성되어 저장된다 — 단 기존에 수동으로 그린/편집한 노선도 이때 같이 덮어써져 사라진다. 이 토글을 꺼서 기존 노선을 보존한 경우엔 `PtLineValidation`이 새 네트워크와의 정합을 검증만 하고 자동 재매핑은 하지 않으므로, 재임포트로 안 맞게 되면 노선을 다시 그려야 한다.

역할: 철도 노선과 운행시각을 정의한다.

계층구조:

```text
Mode
 └─ Lines
     └─ Line
         └─ stationSeq
```

주요 속성:

| 요소 | 속성 |
|---|---|
| `Mode` | `type` |
| `Line` | `id`, `fee`, `departureTime` |
| `stationSeq` | `id`, `seq`, `timeOffset` |

예시:

```xml
<Line id="1_up" fee="1550" departureTime="05:39 05:54 06:07 ...">
  <stationSeq id="40000001" seq="0" timeOffset="0"/>
</Line>
```

---

<a id="railstation-xml"></a>

## `railStation.xml` [조건부]

선택  
철도 사용 시 필요

> ⚠️ **역과 출입구는 id 카운터를 공유**: `railStation.id`와 그 `exit.id`는 OSM 자동 스냅 시 하나의 카운터(`31,000,001`부터)를 나눠 쓴다 — 아래 예시의 `id="40000001"`은 부천 레퍼런스 데이터셋 값이니 착오하지 말 것([ID 네이밍/채번 규칙](#id-naming) 참고). 과거 `OsmFacilityConverter.convertRailStations()`의 exit id 채번이 `idGen.get()`만 하고 증가시키지 않아, 다음 역이 그 exit와 같은 id를 이어받는 충돌 버그가 있었다 — `idGen.getAndIncrement()`로 수정 완료됨(코드의 "실측 크래시" 주석 참고).

역할: 철도역과 출입구 정보를 정의한다.

계층구조:

```text
RailPublicTransit
 └─ railStations
     └─ railStation
         └─ exit
```

주요 속성:

| 요소 | 속성 |
|---|---|
| `railStation` | `id`, `name`, `center`, `lineList`, `transitMode` |
| `exit` | `id`, `linkRef`, `offset`, `accessTime`, `coord` |

예시:

```xml
<railStation id="40000001" name="가나다" transitMode="subway" lineList="1_up 1_down" center="1815.1957 1448.6628">
  <exit id="1" linkRef="20000504" offset="24" accessTime="240" coord="1865.6653 1424.263"/>
</railStation>
```

---

<a id="footpathnetwork-xml"></a>

## `footpathNetwork.xml` [조건부]

조건부  
**승객 OD 수요(`passenger.xml`)가 있을 때만 존재해야 한다** — `PaxRoute.json`이 실제로 생성될 때(=`hasPassengerDemand`가 true일 때)와 정확히 같은 조건. 승객 수요가 없으면(=PaxRoute.json이 빈 stub) footpathNetwork.xml도 아예 없어야 한다(`NextSimRunner.stageInputs()`, 없으면 이전 run의 잔여 파일까지 명시적으로 삭제).

역할: 보행 네트워크를 정의한다. `network.xml`의 전체 노드를 좌표만 x_coord/y_coord로 풀어 그대로 미러링한 형태로 생성된다(`NextSimRunner.buildFootpathNetworkFromNodes`).

> ⚠️ **정확한 트리거 조건(2026-07-29 정정)**: 처음엔 "PT 정류장이 있으면"(`roadStation.xml`/`railStation.xml`에 실제 station이 있는지)으로 게이팅했었다. 실측(scenario2_1, 2026-07-28) 확인 결과, footpathNetwork.xml을 항상 빈 스텁으로 두면 NextSim이 PT 정류장 위치에서 "가장 가까운 보행 네트워크 지점"을 못 찾아(`Captain::footpath::FindNearestFootpathLinkPoint`) `"GetDistance Error: Could not find nearest link point for origin (...)"`로 실패하고 시뮬레이션이 불안정해졌었는데, 게이팅 기준 자체가 정류장 유무가 아니라 **승객 수요 유무**여야 한다는 게 이후 확인되어 정정됐다. 정류장은 있어도 승객 수요가 없으면 pax-route-generator 자체가 안 돌아 footpath 조회가 발생하지 않는다.

계층구조:

```text
Network
 └─ nodes
     └─ node
```

주요 속성:

| 요소 | 속성 |
|---|---|
| `Network` | `id` |
| `node` | `id`, `type`, `x_coord`, `y_coord`, `v2x`, `num_port`, `num_connection` |

예시:

```xml
<node id="10000507" type="intersection" num_port="9" num_connection="24" x_coord="26.3173" y_coord="-9.4967"/>
```

---

<a id="backgroundtraffic-xml"></a>

## `backgroundTraffic.xml` [선택]

선택

역할: 시뮬레이션 시작 시점의 초기 배경교통 상태를 정의한다.

계층구조:

```text
BackgroundTraffics
 └─ state
```

주요 속성:

| 요소 | 속성 |
|---|---|
| `state` | `id`, `avgSpd`, `density` |

예시(값이 채워진 경우 — 실제 관측 데이터 기준):

```xml
<state id="20000403" avgSpd="12.862653552" density="2.628161524"/>
```

> `NextSimRunner.java`는 이 파일이 이미 없을 때만(`writeIfAbsent`) **빈 스텁**(`<BackgroundTraffics></BackgroundTraffics>`)을 써넣는다 — 위처럼 `state`가 채워진 배경교통 데이터를 우리 쪽 코드가 자동 생성하지는 않는다(재임포트 시 이전 파일이 남아있으면 그대로 보존됨).

---

<a id="events-xml"></a>

## `events.xml` [선택]

선택

역할: 외부 이벤트를 입력하기 위한 파일이다. 현재 예제에서는 비어 있다.

계층구조:

```text
Events
```

---

<a id="output-data"></a>

# Output 데이터

<a id="simulationinfo-xml"></a>

## `SimulationInfo.xml`

역할: 시뮬레이션 실행 메타정보를 저장한다.

계층구조:

```text
Simulation_Data
 └─ simulation
     ├─ info
     ├─ runtime
     ├─ meso
     └─ micro
```

주요 속성:

| 요소 | 속성 |
|---|---|
| `simulation` | `id` |
| `info` | `totalRuntime`, `runtimePerCycle`, `totalCycle`, `odScenario` |
| `runtime` | `times` |
| `meso` | `linkId` |
| `micro` | `linkId` |

예시:

```xml
<simulation id="0">
  <info totalRuntime="164417" runtimePerCycle="4.567139" totalCycle="36000" odScenario="0"/>
  <micro linkId=""/>
</simulation>
```

---

<a id="vehicle-json"></a>

## `Vehicle.json`

역할: 차량별 요약 결과를 저장한다.

> ⚠️ **현재 우리 백엔드/프론트엔드 코드 어디에서도 이 파일을 읽지 않는다**(레포 전체에 `Vehicle.json`/`VehicleID`/`CurrentLinkID`/`RouteVector` 등 참조가 전무함). 실제 시뮬레이션 결과 파이프라인은 `simulation_output.db`(SQLite) → `VehicleDataReader.java` → CZML(`czmlPositionWorker.ts`) 경로를 쓴다. 이 파일은 NextSim이 여전히 생성은 하지만(실측 확인) 우리 시스템은 소비하지 않는, 아마도 이전 파이프라인의 흔적으로 보인다. 스키마 자체(아래)는 실제 생성 파일과 대조 확인해 정확하다.

구조(최상위는 배열이 아니라 `Vehicle` 키로 감싼 객체):

```text
{ "Vehicle": Vehicle[] }
 └─ Vehicle[]
     ├─ Info
     ├─ State
     └─ Route
```

`Info` 필드:

```text
VehicleID
VehicleName
RecordType
Type
SourceID
SinkID
DummyType
MaxSpeed
OriginMaxSpeed
Acceleration
Deceleration
MaxAcceleration
MaxDeceleration
JamGap
OriginJamGap
Length
WaveTravelTime
OriginWaveTravelTime
MaxPassengerNum
LCparam1
LCparam2
LCsensitivity
```

`State` 필드:

```text
PreviousLaneIndex
CurrentLinkID
CurrentLaneIndex
CurrentCellIndex
TargetLaneIndex
OriginalTargetLaneIndex
CurrentLinkType
CurrentLaneWidth
VehiclePosition
RemainingDistance
Speed
Acceleration
IsParked
ElcCounter
lcDirection
```

`VehiclePosition` 구조:

```text
X
Y
```

`Route` 필드:

```text
RouteID
Preference
RouteCost
CurrentRouteIndex
RouteVector
RouteDistance
```

`RouteVector` 구조:

```text
Type
RouteSubType
PrimaryID
Length
TargetLaneVector
StationIdVector
```

예시:

```json
{
  "Info": {
    "VehicleID": 6950,
    "VehicleName": "NV_6950",
    "Type": "NV",
    "SourceID": 11000405,
    "SinkID": 11000402,
    "MaxSpeed": 13.81137100906107,
    "Length": 4.898824658777319
  },
  "State": {
    "CurrentLinkID": 20000405,
    "CurrentLaneIndex": 0,
    "CurrentCellIndex": 4,
    "Speed": 13.88888888888889,
    "lcDirection": "Straight"
  },
  "Route": {
    "RouteID": 0,
    "Preference": "Distance",
    "RouteCost": 582.21,
    "RouteDistance": 582.21
  }
}
```

---

<a id="simulation-output-db"></a>

## `simulation_output.db`

역할: 시뮬레이션 상세 결과를 저장하는 SQLite 데이터베이스 파일이다.

차량 루트 입력 파일이 아니라, 시뮬레이션이 끝난 뒤 생성되는 결과 DB다.

SQLite3로 확인한 테이블 구조는 다음과 같다.

<a id="vehicleinfo"></a>

### `VehicleInfo`

차량 기본정보

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `veh_id` | INTEGER | PK |
| `veh_name` | TEXT |  |
| `veh_type` | TEXT |  |
| `origin` | INTEGER | NOT NULL |
| `destination` | INTEGER | NOT NULL |
| `length` | REAL | NOT NULL |
| `width` | REAL | NOT NULL |
| `max_speed` | REAL |  |
| `max_acceleration` | REAL |  |
| `max_deceleration` | REAL |  |
| `jam_gap` | REAL |  |
| `reaction_time` | REAL |  |

예시:

```text
veh_id=1, veh_name=NV_1, veh_type=NV, origin=11000454, destination=11000712, length=5.03, max_speed=45.69
```

<a id="vehicleevent"></a>

### `VehicleEvent`

차량의 시간별 위치/속도 이벤트

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `veh_id` | INTEGER | NOT NULL |
| `timestep` | REAL | NOT NULL |
| `link_id` | INTEGER | NOT NULL |
| `lane_id` | INTEGER | NOT NULL |
| `pos_x` | REAL | NOT NULL |
| `pos_y` | REAL | NOT NULL |
| `heading_deg` | REAL | NOT NULL |
| `spd` | REAL | NOT NULL |
| `acc` | REAL | NOT NULL |
| `mode` | TEXT | NOT NULL |

예시:

```text
veh_id=139, timestep=80.0, link_id=20000403, lane_id=2, pos_x=73.5115, pos_y=342.5486, spd=50.0, acc=0.0
```

<a id="vehicleeventdebugging"></a>

### `VehicleEventDebugging`

차량 이벤트 상세 디버깅 정보

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `veh_id` | INTEGER | NOT NULL |
| `type` | INTEGER |  |
| `timestep` | REAL |  |
| `link_id` | INTEGER |  |
| `lane_id` | INTEGER |  |
| `cell_id` | INTEGER |  |
| `pos_x` | REAL |  |
| `pos_y` | REAL |  |
| `heading_deg` | REAL |  |
| `spd` | REAL |  |
| `acc` | REAL |  |
| `spacing` | TEXT |  |
| `mode` | TEXT |  |
| `modes` | TEXT |  |
| `leader_id` | INTEGER |  |
| `leader_spd` | REAL |  |
| `target_lane_id` | INTEGER |  |
| `sim_mode` | INTEGER |  |
| `source_id` | INTEGER |  |
| `sink_id` | INTEGER |  |
| `max_spd` | REAL |  |
| `is_tail_gating` | INTEGER |  |
| `count_lc` | INTEGER |  |
| `elc_counter` | INTEGER |  |
| `new_sink_id` | INTEGER |  |
| `v2x` | INTEGER |  |
| `v2x_msg_type` | TEXT |  |
| `v2x_value` | REAL |  |

예시:

```text
veh_id, timestep, link_id, lane_id, cell_id, spd, leader_id, target_lane_id, v2x, v2x_msg_type, v2x_value 등을 포함
```

<a id="vehiclestatistics"></a>

### `VehicleStatistics`

차량별 전체 통행 통계

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `veh_id` | INTEGER | PK |
| `src` | INTEGER | NOT NULL |
| `sink` | INTEGER | NOT NULL |
| `travel_start_time` | REAL | NOT NULL |
| `travel_end_time` | REAL | NOT NULL |
| `avg_speed` | REAL |  |
| `travel_time` | REAL |  |
| `travel_distance` | REAL |  |
| `delay_time` | REAL |  |
| `travel_cost` | INTEGER |  |

예시:

```text
veh_id=1, src=11000454, sink=11000712, travel_start_time=0.0, travel_end_time=35.0, avg_speed=11.3976, travel_time=35.0, delay_time=5.1207
```

<a id="vehiclelinkstatistics"></a>

### `VehicleLinkStatistics`

차량별 링크 통과 통계

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `veh_id` | INTEGER | NOT NULL |
| `link_id` | INTEGER | NOT NULL |
| `arrival_time` | REAL |  |
| `departure_time` | REAL |  |
| `avg_speed` | REAL |  |
| `travel_time` | REAL |  |
| `travel_distance` | REAL |  |
| `delay_time` | REAL |  |
| `travel_cost` | INTEGER |  |

예시:

```text
veh_id, link_id, arrival_time, departure_time, avg_speed, travel_time, travel_distance, delay_time, travel_cost
```

<a id="cellevent"></a>

### `CellEvent`

셀 단위 교통류 결과

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `timestep` | REAL | NOT NULL |
| `link_id` | INTEGER | NOT NULL |
| `lane_id` | INTEGER | NOT NULL |
| `cell_id` | INTEGER | NOT NULL |
| `avg_spd` | REAL |  |
| `density` | REAL |  |
| `num_veh` | INTEGER |  |
| `intercell_flow` | REAL |  |
| `inflow` | REAL |  |
| `outflow` | REAL |  |

예시:

```text
timestep=0.0, link_id=20000402, lane_id=0, cell_id=0, avg_spd=13.8889, density=0.0, num_veh=0
```

<a id="paxevent"></a>

### `PaxEvent`

승객 이벤트

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `pax_id` | INTEGER | NOT NULL |
| `event_type` | TEXT | NOT NULL |
| `timestep` | REAL | NOT NULL |
| `origin_id` | INTEGER | NOT NULL |
| `dest_id` | INTEGER | NOT NULL |
| `mode` | TEXT | NOT NULL |
| `mode_id` | TEXT | NOT NULL |
| `fee` | REAL | NOT NULL |

예시:

```text
pax_id=20, event_type=ArriveStation, timestep=51.7, origin_id=30011458, dest_id=30011463, mode=Wait, fee=0.0
```

<a id="stationevent"></a>

### `StationEvent`

정류장 이벤트

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `station_id` | INTEGER | NOT NULL |
| `timestep` | REAL | NOT NULL |
| `type` | TEXT |  |
| `veh_id` | INTEGER |  |
| `line_id` | INTEGER |  |
| `pax_in` | INTEGER |  |
| `pax_out` | INTEGER |  |
| `pax_total` | INTEGER |  |
| `location` | INTEGER |  |

예시:

```text
station_id=30011483, timestep=150.0, type=PaxExchange, veh_id=2, pax_in=0, pax_out=2, pax_total=0, location=20000472
```

<a id="sinkevent"></a>

### `SinkEvent`

도착지/유출부 이벤트

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `sink_id` | INTEGER | NOT NULL |
| `timestep` | REAL | NOT NULL |
| `flow` | REAL | NOT NULL |
| `count` | INTEGER | NOT NULL |

예시:

```text
sink_id=11000402, timestep=0.0, flow=0.0, count=0
```

<a id="signalcontrolevent"></a>

### `SignalControlEvent`

신호제어 이벤트

| 컬럼 | 타입 | 제약 |
|---|---|---|
| `mode` | TEXT | NOT NULL |
| `timestep` | REAL | NOT NULL |
| `link_id` | INTEGER | NOT NULL |
| `lane_id` | INTEGER | NOT NULL |
| `turn_id_list` | TEXT | NOT NULL |
| `num_veh` | INTEGER | NOT NULL |
| `num_queue` | INTEGER | NOT NULL |

예시:

```text
mode, timestep, link_id, lane_id, turn_id_list, num_veh, num_queue
```

---
