# IITP 광역권 모빌리티 시뮬레이션 프로젝트

IITP(정보통신기획평가원) 과제: 광역권 도시를 위한 차세대 AI 융합 모빌리티 시뮬레이션 및 예측/활용 기술 개발 (2024.07 ~ 2027.12)

## 프로젝트 구조

```
iitp/
├── iitp-front/       # React + TypeScript 프론트엔드
├── iitp-rest/        # Spring Boot 백엔드
├── docker-compose.yml
└── database/
```

## 기술 스택

### 프론트엔드 (`iitp-front/`)
- **React 18** + **TypeScript** + **Vite 6**
- **CesiumJS `^1.127.0`** (`vite-plugin-cesium ^1.2.23`) — 3D 지도 (도로 네트워크, 시뮬레이션 가시화)
- **OpenLayers `^10.10.0`** (`@types/ol ^6.5.3`) — 2D 지도 (레이어 편집, 네트워크 드로우)
- **Zustand 5** — 전역 상태 관리 (`subscribeWithSelector` 미들웨어 사용)
- **AG Grid 33** — 테이블 UI
- **Ant Design 5** — UI 컴포넌트
- **Deck.gl 9** — 히트맵 분석

### 백엔드 (`iitp-rest/`)
- **Java 23** + **Spring Boot 3.4** + **Gradle**
- **PostgreSQL** — 주 데이터베이스 (JPA/Hibernate)
- **JAXB** — network.xml 파싱
- **SFTP** — 네트워크 파일 저장 (gaia3d 서버)
- **Overpass API** — OSM 도로 데이터 수집

## 핵심 도메인 개념

### 네트워크 데이터 구조
```
Network
├── nodes[]     — 교차로 노드 (좌표, ports, connections)
│   ├── ports[] — 링크 연결 포트 (in/out)
│   └── connections[] — 회전 연결 (fromLink/toLane → toLink/toLane)
└── links[]     — 도로 링크 (fromNode → toNode)
    └── lanes[] — 차선
        ├── cells[]    — 셀 (CTM 모델)
        └── segments[] — 구간
```

### GUID 시스템
모든 도메인 객체는 `__guid`와 `featureType` 프로퍼티를 가짐.

- `assignPropertyToResponseData(data)` — 서버 응답에 `__guid`/`featureType` 부여 (경로 기반, 예: `"links.links-0.lanes.lanes-1"`)
- `__guid`는 레이어 내 엔티티 ID로 사용됨
- **반드시 `setCurrentJsonData()` 호출 전에 `assignPropertyToResponseData()`를 먼저 호출할 것**

### 시나리오 & 버전
- `Scenario` — 교통 시나리오 (key, 좌표)
- `ScenarioVersions` — 시나리오 버전 (key → SFTP 경로로 사용)
- 모든 API 호출 URL: `/api/{versionId}` 형태

## 이중 지도 공통 관리 구조 (Dual-Map Architecture)

CesiumJS(3D)와 OpenLayers(2D)가 동시에 실행되며, `LayerManager`가 두 지도를 통합 조율한다.

### LayerManager — 단일 진입점

```
LayerManager
├── PrimitiveLayerManager   — Cesium PrimitiveCollection (차량 모델, 히트맵, tail)
├── BaseMapLayerManager     — Cesium ImageryLayer (VWorld 위성/하이브리드 배경지도)
├── DataSourceLayerManager  — Cesium CustomDataSource (시설물: 네트워크, 버스정류장 등)
├── VectorLayerManager      — OL VectorLayer / WebGLVectorLayer (시설물 편집)
└── TileLayerManager        — OL TileLayer XYZ (OL 배경지도)
```

### 동시 레이어 생성 패턴

`LayerManager`의 각 `addXxxLayer()` 메서드는 하나의 논리적 레이어에 대해 **CesiumJS 오브젝트와 OL 오브젝트를 동시에 생성**한다.

```
addHeatmapLayer()   → PrimitiveLayerManager(Cesium) + VectorLayerManager(OL)
addVehicleLayer()   → PrimitiveLayerManager(Cesium) + VectorLayerManager(OL)
addTripLayer()      → PrimitiveLayerManager(Cesium) + VectorLayerManager(OL)
addFacilityLayers() → DataSourceLayerManager(Cesium) + VectorLayerManager(OL)
addBaseMapLayer()   → BaseMapLayerManager(Cesium) + TileLayerManager(OL)
```

즉 레이어 가시성 토글, 데이터 갱신 등 모든 레이어 조작은 항상 두 지도에 동시 적용된다.

### 레이어 그룹

| 그룹명       | 용도                                |
|------------|-------------------------------------|
| `baseMap`  | 배경지도 (위성, 하이브리드)            |
| `facility` | 시설물 (네트워크, 버스정류장, 신호 등) |
| `analyze`  | 분석 결과 (히트맵, 차량 궤적 등)      |

### 지도 표시 모드 (`Maps.tsx`)

| 모드      | 동작                                                        |
|---------|-------------------------------------------------------------|
| **분할** (기본) | OL 좌측 / Cesium 우측, 드래그 디바이더로 너비 조정          |
| **단일** (대시보드) | 두 지도를 `position:absolute`로 겹쳐두고 `visibility`로 전환 |

> **주의**: 단일 모드에서 숨길 때 `width:0`을 사용하면 WebGL 컨텍스트가 중단되어 시뮬레이션 업데이트 루프가 끊긴다. 반드시 `visibility: hidden` + `pointerEvents: none`을 사용할 것.

---

## 레이어 아키텍처

### 레이어 생성 흐름 (`useLayerInit.ts`)
```
1. API 데이터 fetch → setOriginData() + assignPropertyToResponseData()
2. addFacilityLayers() — DataSource/Feature 레이어 인스턴스 생성
3. initCurrentData() — originData → currentJsonData 복사 → 구독 트리거
```

- `isInitializedRef`로 중복 실행 방지 (컴포넌트 마운트당 1회)
- 초기화 완료 시 `useLayerStore.setInitialized(true)` → 로딩 오버레이 제거

### 레이어 등록 규칙 (자동 매핑)
`addFacilityLayers()` 에서 파일명 기반 자동 등록:
- `@datasource/{PascalKey}DataSourceLayer.ts` → CesiumJS 레이어
- `@features/{PascalKey}FeatureLayer.ts` → OpenLayers 레이어

예: facility 그룹의 `network` 키 → `NetworkDataSourceLayer`, `NetworkFeatureLayer` 자동 생성

### 스토어 ↔ 레이어 구독 패턴
```typescript
// 레이어 생성자에서 store 구독
const store = layerNameToStoreMap[this.LAYER_NAME];
this.unsubscribe = store.subscribe(
    (state) => state.currentJsonData,
    () => this.load(),  // or this.scheduleLoad()
    { equalityFn: (a, b) => a === b }  // 참조 동등성
);
```

- `setCurrentJsonData(data)` — `structuredClone(data)`로 새 참조 생성 → 구독 트리거
- `initCurrentData()` — `originData`를 직접 할당 (clone 없음)
- **CesiumJS 레이어 `load()` 완료 후 반드시 `this.dataSource.show = true` 설정** (entities가 있을 때)

### `layerNameToStoreMap` / `menuCodeToStoreMap`
```typescript
// useLayerInit.ts
export const layerNameToStoreMap = {
    network: useNetworkStore,
    busStation: useBusStationStore,
    ...
}
export const menuCodeToStoreMap = {
    NETWORK: useNetworkStore,
    BUS_STATION: useBusStationStore,
    ...
}
```

## 스토어 패턴 (`useFeatureStoreFactory.ts`)

모든 도메인 스토어는 `createFeatureStore<T>()` 팩토리로 생성:

```typescript
store.getState().setOriginData(data)        // 서버 원본 저장
store.getState().initCurrentData()          // originData → currentJsonData
store.getState().setCurrentJsonData(data)   // 구독 트리거 (structuredClone 사용)
store.getState().updateCurrentJsonData(record, historyStore)  // GUID 기반 깊은 업데이트
store.getState().removeRecordsByGuid(guids, historyStore)     // 삭제
```

- `originData`: 서버 원본 (변경 불가)
- `currentJsonData`: 현재 편집 상태
- `isChanged`: 저장 필요 여부

## CesiumJS DataSource 레이어 작성 규칙

```typescript
export default class XxxDataSourceLayer {
    private readonly LAYER_NAME = "xxx";  // layerNameToStoreMap 키와 일치
    private dataSource: Cesium.CustomDataSource;
    private unsubscribe: (() => void) | undefined;
    private loadTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private viewer: Viewer) {
        this.dataSource = new Cesium.CustomDataSource(this.LAYER_NAME);
        this.viewer.dataSources.add(this.dataSource);
        this.load();
        // store 구독 설정...
    }

    private scheduleLoad(): void {
        if (this.loadTimer) clearTimeout(this.loadTimer);
        this.loadTimer = setTimeout(() => {
            this.loadTimer = null;
            this.load();
        }, 150);
    }

    public async load(): Promise<void> {
        if (!this.viewer.dataSources.contains(this.dataSource)) {
            this.viewer.dataSources.add(this.dataSource);
        }
        this.dataSource.entities.suspendEvents();
        try {
            this.dataSource.entities.removeAll();
            // 엔티티 추가...
            if (this.dataSource.entities.values.length > 0) {
                this.dataSource.show = true;  // 중요: 반드시 필요
            }
        } catch (error) {
            console.error(`XxxDataSourceLayer.load() 에러:`, error);
        } finally {
            this.dataSource.entities.resumeEvents();
            try { this.viewer.scene.requestRender(); } catch (_) {}
        }
    }

    public destroy(): void {
        this.unsubscribe?.();
        this.viewer.dataSources.remove(this.dataSource, true);
    }
}
```

**주의사항**:
- `dataSource.show = true` 없으면 `basic: false` 레이어는 영원히 숨겨짐
- `nodeMap`/`linkMap` 키는 항상 `String()` 변환: `nodeMap.set(String(node.id), node)`
- Promise chain에서 null 구조 분해 금지: `return null` 후 `({nodes}) => ...` 패턴 사용 불가

## OpenLayers Feature 레이어 작성 규칙

```typescript
export default class XxxFeatureLayer extends VectorLayer {
    private readonly LAYER_NAME = "xxx";

    constructor() {
        const source = new VectorSource();
        super({ source, visible: false });
        this.load();
        // store 구독...
    }

    public async load(): Promise<void> {
        this.source.clear();
        // feature 추가...
    }

    public dispose(): void {
        this.unsubscribe?.();
        super.dispose();
    }
}
```

## 데이터 입출력

### 파일 가져오기 흐름 (공통 패턴)
```typescript
assignPropertyToResponseData(data);         // 1. GUID 부여
store.getState().setCurrentJsonData(data);  // 2. 스토어 업데이트 → 구독 트리거
store.getState().setChange(true);           // 3. 변경 플래그
```

### 네트워크 XML 임포트 (`NetworkImportModal`)
- `POST /network/{versionId}/import` — XML 업로드 → SFTP 저장 → `NetworkResponse` 반환
- `GET /network/{versionId}/backup` — 기존 파일 백업 다운로드

### JSON 데이터 입출력 (`DataIOPanel`)
- Export: `{ __iitp_layer: "network", data: currentJsonData }` 형식
- Import: `__iitp_layer` 또는 `__iitp_export` 키로 레이어 구분

### OSM 가져오기
- `GET /network/import/osm/save?bbox=...&versionId=...` — OSM → network.xml 변환 + SFTP 저장

## 환경 설정

### 프론트엔드 `.env`
```
VITE_API_URL=http://localhost:9090
REACT_APP_FILE_BASE_URL=/file-proxy
REACT_APP_FILE_ORIGIN=http://seoul.gaia3d.com:10217
REACT_APP_VWORLD_API_KEY=...
```

### 백엔드 프로파일
- `application.properties` — 로컬 (localhost:5432)
- `application-develop.properties` — 개발 서버 (192.168.10.182:45432)

### 실행
```bash
# 프론트엔드
cd iitp-front && yarn dev

# 백엔드
cd iitp-rest && ./gradlew bootRun

# DB (Docker)
docker-compose up -d postgres
```

## 자주 실수하는 패턴

### ❌ 하지 말 것
```typescript
// 1. DataSource 레이어에서 show = true 누락
this.dataSource.entities.add(...);
// show 설정 없음 → basic:false 레이어는 영원히 숨겨짐

// 2. GUID 없이 setCurrentJsonData 호출
store.getState().setCurrentJsonData(data); // assignPropertyToResponseData 먼저!

// 3. Promise chain에서 null 구조 분해
.then(res => res.ok ? res.json() : null)
.then(({nodes}) => ...) // null이면 TypeError

// 4. Map 키 타입 불일치
const nodeMap = new Map<string | number, any>();
nodeMap.set(node.id, node);      // number
nodeMap.get(link.fromNode);      // string이면 undefined 반환
```

### ✅ 올바른 패턴
```typescript
// 1. DataSource 레이어 show 설정
if (this.dataSource.entities.values.length > 0) {
    this.dataSource.show = true;
}

// 2. GUID 부여 후 스토어 업데이트
assignPropertyToResponseData(data);
store.getState().setCurrentJsonData(data);

// 3. null-safe Promise chain
.then(res => res.ok ? res.json() : null)
.then(data => {
    if (!data) return;
    data.nodes?.forEach(...);
})

// 4. String 통일
const nodeMap = new Map<string, any>();
nodeMap.set(String(node.id), node);
nodeMap.get(String(link.fromNode));
```

## 레이어 스키마 API

`GET /layer/group` 응답이 레이어 그룹 스키마를 정의:
- `facility` 그룹의 `fields[].key` → `{key}DataSourceLayer`, `{key}FeatureLayer` 자동 생성
- `fields[].basic: true` → 기본 표시, `false` → 숨김 (레이어 `load()` 후 `show=true` 설정 필요)

## Cesium 렌더링 주의사항

- `requestRenderMode: true`, `maximumRenderTimeChange: Infinity` 설정으로 수동 렌더 요청 필요
- 엔티티 추가/삭제 시 `suspendEvents()` / `resumeEvents()` + `requestRender()` 사용
- `DataSource`가 viewer에서 제거될 수 있으므로 `load()` 시작 시 `dataSources.contains()` 확인 후 재추가
