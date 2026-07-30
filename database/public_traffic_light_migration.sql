-- 공공데이터포털(data.go.kr) "전국 교통신호기표준데이터"(tn_pubr_public_traffic_light_api) DB 구축
--
-- 배경: OSM highway=traffic_signals(+crossing=traffic_signals)를 신호 위치 판정 근거로
-- 썼더니(osm_traffic_signal_migration.sql) 실측(2026-07-29, 강남 지역) 결과 유명 교차로
-- (역삼역앞교차로·선정릉역사거리·차병원사거리 등)조차 OSM에 신호 태그가 300~900m 이내에
-- 전혀 없어 대량 과소생성을 유발했다 — OSM 자체의 신호등 태깅 공백. 경찰청이 공식 관리하는
-- 이 표준데이터(전국 98,878건, 위경도 포함)가 OSM보다 훨씬 신뢰할 만한 근거일 가능성이 높아
-- 별도로 구축한다.
--
-- 임포터: PublicTrafficLightImporter.java (data.go.kr REST API 페이지네이션 수집)
-- 조회: PublicTrafficLightRepository — DummySignalGenerator(백엔드) 등에서 사용 예정.
--
-- tfclghtManageNo(관리번호)는 기관별 로컬 번호라 전국 유일하지 않음(실측: 아산시 내 여러
-- 행이 "1498"/"1548" 같은 소번호) — surrogate BIGSERIAL을 PK로 쓴다.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS public_traffic_light (
    id BIGSERIAL PRIMARY KEY,
    ctprvn_nm TEXT,
    signgu_nm TEXT,
    road_route_nm TEXT,
    lnmadr TEXT,
    rdnmadr TEXT,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    tfclght_manage_no TEXT,
    tfclght_se TEXT,
    institution_nm TEXT,
    reference_date TEXT,
    geom GEOMETRY(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_public_traffic_light_geom ON public_traffic_light USING GIST (geom);

CREATE TABLE IF NOT EXISTS public_traffic_light_import_meta (
    id INTEGER PRIMARY KEY DEFAULT 1,
    imported_at TIMESTAMP NOT NULL,
    total_count BIGINT,
    CHECK (id = 1)
);
