-- OSM 회전제약(turn restriction) 자체 DB 구축
--
-- 배경: KTDB의 connection(회전 허용 목록) 생성은 KTDB 자체가 "이 회전은 된다"를 명시하는 게
--   아니라 진입/진출 링크 전조합(단순 노드) 또는 내부링크 BFS 도달성(병합 교차로)으로 후보를
--   만들고, ktdb_turninfo.turn_oper='1'(금지)인 쌍만 제거하는 규칙 기반이다. 이 turninfo가
--   커버 못 하는 실제 회전 금지는 전부 "허용"으로 새어나간다(실측: 강남 일대 bbox에서 OSM
--   회전제약과 대조해 13건 발견). OSM의 type=restriction relation(no_left_turn 등, from/via/to
--   멤버로 회전을 명시)을 turn_oper='1'과 동일한 위치에 추가 금지 필터로 끼워넣는다.
--
-- 임포터: OsmTurnRestrictionImporter.java — osmium으로 필터링한 OSM XML을 파싱하면서
--   via 노드 좌표 + from/to way의 via 인접 진행방향(bearing)까지 임포트 시점에 미리 계산해
--   저장한다(조회 시점엔 좌표 계산 없이 바로 각도 비교만 하면 되게).
-- 조회: OsmTurnRestrictionRepository.findProhibitingRestriction(nodeLat, nodeLon, inBearing, outBearing)
-- 사용처: KtdbNetworkConverter/KtdbStreamingConverter의 connection 후보 필터링

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS osm_turn_restriction (
    id BIGINT PRIMARY KEY,
    restriction VARCHAR(30) NOT NULL,  -- no_left_turn / no_right_turn / no_straight_on / no_u_turn /
                                        -- only_left_turn / only_right_turn / only_straight_on / only_u_turn
    via_lat DOUBLE PRECISION NOT NULL,
    via_lon DOUBLE PRECISION NOT NULL,
    from_bearing DOUBLE PRECISION,     -- via로 들어오는 진행방향(도, 0=북/시계방향) — 계산 실패 시 NULL
    to_bearing DOUBLE PRECISION,       -- via에서 나가는 진행방향(도) — 계산 실패 시 NULL
    geom GEOMETRY(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_osm_turn_restriction_geom ON osm_turn_restriction USING GIST (geom);

CREATE TABLE IF NOT EXISTS osm_turn_restriction_import_meta (
    id INTEGER PRIMARY KEY DEFAULT 1,
    imported_at TIMESTAMP NOT NULL,
    source_file TEXT,
    total_relations BIGINT,
    resolved_count BIGINT,
    CHECK (id = 1)
);
