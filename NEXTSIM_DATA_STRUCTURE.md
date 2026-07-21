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
         └─ network_xml_bucheon/
             ├─ network.xml
             ├─ scenario.xml
             ├─ odmatrix.xml
             ├─ signal.xml
             ├─ signalTOD.xml
             ├─ mode.xml
             ├─ Route.json
             └─ ...
```

`config.txt`는 실제 사용할 네트워크 폴더를 지정하는 파일이다.

```text
network_name=bucheon
branch=mesopt
```

위 설정은 다음 경로를 의미한다.

```text
SimulationInput/datasets/mesopt/network_xml_bucheon/
```

즉 규칙은 다음과 같다.

```text
SimulationInput/datasets/{branch}/network_xml_{network_name}/
```

새 네트워크를 추가하려면 예를 들어 `network_name=seoul`, `branch=mesopt`로 설정하고, 입력 파일들은 아래 경로에 넣으면 된다.

```text
SimulationInput/datasets/mesopt/network_xml_seoul/
```

공통 파라미터 파일은 branch 아래의 `parameter_xml` 폴더를 사용한다.

```text
SimulationInput/datasets/{branch}/parameter_xml/
```

따라서 네트워크를 바꿀 때는 보통 다음 두 가지를 맞춰야 한다.

1. `SimulationInput/config.txt`의 `network_name`, `branch` 수정
2. `SimulationInput/datasets/{branch}/network_xml_{network_name}/` 안에 필수 입력 파일 배치

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
SimulationInput/datasets/mesopt/network_xml_bucheon/
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

역할: 사용할 네트워크 데이터셋을 지정한다.

구조:

```text
network_name=bucheon
branch=mesopt
```

필드:

| 필드 | 설명 |
|---|---|
| `network_name` | 사용할 네트워크 이름 |
| `branch` | 사용할 데이터셋/모델 분기 |

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
| `node` | `id`, `type`, `v2x`, `x_coord`, `y_coord`, `num_port`, `num_connection`, `center` |
| `port` | `type`, `direction`, `link_id` |
| `connection` | `id`, `from_link`, `from_lane`, `to_link`, `to_lane`, `turning`, `length`, `width`, `ff_spd`, `shape` |
| `link` | `id`, `from_node`, `to_node`, `num_lane`, `length`, `width`, `min_spd`, `max_spd`, `ff_spd`, `wave_spd`, `qmax`, `max_veh`, `sim_type`, `type`, `stop_line`, `shape` |
| `lane` | `id`, `num_cell`, `left_lane_id`, `right_lane_id`, `shape` |
| `cell` | `id`, `length`, `offset` |
| `segment` | `id`, `block`, `init_point`, `end_point`, `left_lc`, `right_lc` |
| `section` | `id`, `length`, `offset`, `slope`, `left_id`, `right_id` |

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

예시:

```json
{
  "id": 0,
  "startTime": "05:59:00",
  "duration": 60,
  "trafficCenter": {
    "signalControl": { "active": false, "interval": 1.0 },
    "v2x": { "active": true, "interval": 1.0 }
  }
}
```

---

<a id="odmatrix-xml"></a>

## `odmatrix.xml` [필수]

필수

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
| `phase` | `id`, `duration`, `minGreenTime`, `maxGreenTime`, `turnList` |

예시:

```xml
<plan id="0" cycle="200" offset="0"/>
<phase id="0" duration="34" turnList="11 12 0 4 6 10" minGreenTime="15" maxGreenTime="40"/>
<turn id="0" turning="R" type="RTOR" connList="11"/>
```

---

<a id="signaltod-xml"></a>

## `signalTOD.xml` [필수]

필수

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

예시:

```xml
<VehicleEvent>
  <Debugging active="t" />
  <Visualizer active="t" />
  <Statistics active="t" />
</VehicleEvent>
<SignalEvent active="f" />
```

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

선택  
승객 보행/환승 경로 사용 시 필요

역할: 보행 네트워크를 정의한다.

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

예시:

```xml
<state id="20000403" avgSpd="12.862653552" density="2.628161524"/>
```

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

구조:

```text
Vehicle[]
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
