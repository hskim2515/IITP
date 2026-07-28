-- OSM 신호등(highway=traffic_signals) 자체 DB 구축
--
-- 배경: 실측 확인(부천 참조 데이터) — 커넥션이 있는 노드(104개) 중 실제 신호가 있는 노드는
-- 18개뿐이고 나머지 86개는 무신호 우선순위 교차로다. 즉 "커넥션 존재"는 "신호가 필요하다"는
-- 뜻이 아니다. 지금까지 더미 신호 생성(DummySignalGenerator.java, 프론트 signal.ts)은 KTDB
-- 커넥션 구조(진입방향 개수/포트 개수)만 보고 "분기가 있으면 무조건 신호 생성"했는데, 이는
-- 실제로는 무신호인 지점까지 신호로 만드는 과다생성이었다. OSM의 실제 traffic_signals 태그를
-- "여기 진짜 신호등이 있다"는 확인 용도로 써서, 커넥션이 있는 노드 중 실제 신호가 확인된
-- 곳에만 신호를 생성하도록 게이팅한다.
--
-- 임포터: OsmTrafficSignalImporter.java
-- 조회: OsmTrafficSignalRepository — DummySignalGenerator(백엔드)와 GET /network/osm-traffic-signals
--   (프론트 signal.ts가 소비)에서 사용.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS osm_traffic_signal (
    id BIGINT PRIMARY KEY,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    geom GEOMETRY(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_osm_traffic_signal_geom ON osm_traffic_signal USING GIST (geom);

CREATE TABLE IF NOT EXISTS osm_traffic_signal_import_meta (
    id INTEGER PRIMARY KEY DEFAULT 1,
    imported_at TIMESTAMP NOT NULL,
    source_file TEXT,
    signal_count BIGINT,
    CHECK (id = 1)
);
