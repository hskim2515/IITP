-- OSM 대중교통 시설물(버스/철도 정류장·노선) 자체 DB 구축
--
-- 배경: OsmFacilityConverter가 필요로 하는 건 highway=bus_stop / railway=station|halt|
--   tram_stop|subway_entrance|stop 태그를 가진 노드와, route=bus|trolleybus|subway|train|
--   tram|rail 태그를 가진 relation(+참조하는 way/node)뿐인데, 이걸 매번 공개 Overpass API로
--   조회하니 강남역~역�이~선릉 정도의 bbox에서도 1분 이상 걸린다(실측 — 공개 서버 처리 용량
--   한계). KTDB가 이미 PostgreSQL/PostGIS에 도로망을 직접 넣어두고 조회하는 것과 동일한
--   패턴으로, 한국 OSM 추출본(Geofabrik south-korea-latest.osm.pbf)에서 이 태그들만 osmium
--   tags-filter -r(참조 객체 포함)로 뽑아 여기 채워넣고 SQL bbox 조회로 대체한다.
--
-- 임포터: OsmPtFacilityImporter.java (osmium으로 필터링된 .osm XML을 스트리밍 파싱 → 배치 insert)
-- 조회 재작성: OsmOverpassService.queryFacilities() → 이 테이블 SQL 조회로 교체
--   (반환 타입 FacilityQueryResult는 그대로 유지 — OsmFacilityConverter는 무수정)

CREATE EXTENSION IF NOT EXISTS postgis;

-- 대중교통 관련 OSM 노드. tags가 NULL이면 geometry 전용(way/relation 형상 재구성에만 쓰이고
-- 정류장/역으로 직접 표시되지 않음 — 예: 버스 노선 way의 중간 경유 노드).
CREATE TABLE IF NOT EXISTS osm_pt_node (
    id BIGINT PRIMARY KEY,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    tags JSONB,
    geom GEOMETRY(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_osm_pt_node_geom ON osm_pt_node USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_osm_pt_node_tags ON osm_pt_node USING GIN (tags);

-- 노선(relation)이 참조하는 way의 노드 순서 — geometry/링크 스냅 재구성용.
-- node_ids는 순서 보존 JSONB 배열([1,2,3,...]) — java.sql.Array(BIGINT[]) 없이 JDBC로 바로
-- 문자열+::jsonb 캐스트로 넣을 수 있어 배치 insert가 간단하다(tags/members와 동일 방식).
-- bbox는 임포트 시점에 미리 계산한 이 way의 대략적 경계(공간 인덱스 필터용).
CREATE TABLE IF NOT EXISTS osm_pt_way (
    id BIGINT PRIMARY KEY,
    node_ids JSONB NOT NULL,
    -- ⚠️ Polygon으로 고정했다가 실패함 — ST_Envelope는 노드가 2개뿐이거나 위경도 중 하나가
    -- 완전히 같으면 LineString을, 노드가 1개면 Point를 반환한다(실측: osmium 필터링 데이터의
    -- 짧은 way/relation에서 실제 발생). 제네릭 GEOMETRY로 둬서 세 타입 다 받는다.
    bbox GEOMETRY(Geometry, 4326)
);
CREATE INDEX IF NOT EXISTS idx_osm_pt_way_bbox ON osm_pt_way USING GIST (bbox);

-- 버스/철도 노선 relation. members는 순서를 보존한 멤버 목록
-- ([{"type":"way"|"node","ref":123,"role":"..."}]).
CREATE TABLE IF NOT EXISTS osm_pt_relation (
    id BIGINT PRIMARY KEY,
    tags JSONB,
    members JSONB NOT NULL,
    -- ⚠️ Polygon으로 고정했다가 실패함 — ST_Envelope는 노드가 2개뿐이거나 위경도 중 하나가
    -- 완전히 같으면 LineString을, 노드가 1개면 Point를 반환한다(실측: osmium 필터링 데이터의
    -- 짧은 way/relation에서 실제 발생). 제네릭 GEOMETRY로 둬서 세 타입 다 받는다.
    bbox GEOMETRY(Geometry, 4326)
);
CREATE INDEX IF NOT EXISTS idx_osm_pt_relation_bbox ON osm_pt_relation USING GIST (bbox);

-- 임포트 메타(운영 참고용 — 마지막 임포트 시각/소스/건수)
CREATE TABLE IF NOT EXISTS osm_pt_import_meta (
    id INTEGER PRIMARY KEY DEFAULT 1,
    imported_at TIMESTAMP NOT NULL,
    source_file TEXT,
    node_count BIGINT,
    way_count BIGINT,
    relation_count BIGINT,
    CHECK (id = 1)
);
