-- 공공데이터포털(data.go.kr) "교차로정보서비스"(CrossRoadInfoService, 기관코드 1320000) DB 구축
--
-- 배경: 경찰청 전국 교통신호기표준데이터(public_traffic_light_migration.sql)가 강남구를 전혀
-- 커버하지 않아(지자체 자율 업로드 구조 — 강남구 미참여) 대안으로 확인한 데이터. 실측
-- (2026-07-29): 서울시 전역 398건뿐이고 REGION_CD가 전량 단일값("L01")이라 지역 구분이 아니라
-- 등급/유형 분류로 추정 — "주간선도로급 교차로"만 모은 좁은 범위의 목록으로 보인다(TOPIS
-- 스마트교통관제 대상 등). 강남역사거리 등 매칭된 지점은 오차 0m로 좌표 정밀도는 최고 수준.
--
-- ⚠️ 커버리지가 좁아 게이팅(차단) 용도로는 부적합(실측: 차선 3+/50km 이상 도로 교차로 104개
-- 중 겨우 3~7개만 매칭 — 게이팅하면 93%를 잘못 차단). "여기는 확실히 신호교차로다"라는
-- 고신뢰 양성 신호로만 쓴다(참고/시각화용, DummySignalGenerator 생성 로직에는 미반영).
--
-- 임포터: CrossRoadInfoImporter.java (data.go.kr REST API 페이지네이션 수집, numOfRows=100 고정)
-- 조회: CrossRoadInfoRepository — GET /network/crossroad-info(프론트 시각화/QA 참고용).

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS crossroad_info (
    id BIGSERIAL PRIMARY KEY,
    int_no TEXT,
    int_nm TEXT,
    region_cd TEXT,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    upd_dtime TEXT,
    geom GEOMETRY(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crossroad_info_geom ON crossroad_info USING GIST (geom);

CREATE TABLE IF NOT EXISTS crossroad_info_import_meta (
    id INTEGER PRIMARY KEY DEFAULT 1,
    imported_at TIMESTAMP NOT NULL,
    total_count BIGINT,
    CHECK (id = 1)
);
