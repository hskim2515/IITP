-- osm_pt_way에 tags 컬럼 추가 — 중앙버스전용차로(busway/highway=busway 등) 감지를 위해
-- 필요(OsmWay.busLaneSide() 참고). 기존엔 way의 노드 순서(node_ids)만 저장하고 태그는
-- 아예 버렸는데, OsmFacilityConverter.resolveBusLaneIndex()의 2순위 판정(주변 OSM way의
-- 버스전용차로 태그 조회)이 이 정보 없이는 항상 실패해 medianLane이 절대 true가 될 수
-- 없었다(2026-08-03 실사용 발견: "버스노선이 주황색만 보임").
--
-- ⚠️ 컬럼을 추가해도 기존에 이미 임포트된 행은 tags가 NULL로 남는다 — OsmPtFacilityImporter로
-- 재임포트해야 실제로 채워진다(osmium tags-filter 필터도 함께 넓혀야 함,
-- OsmPtFacilityImporter.java 클래스 주석 참고).
ALTER TABLE osm_pt_way ADD COLUMN IF NOT EXISTS tags JSONB;
CREATE INDEX IF NOT EXISTS idx_osm_pt_way_tags ON osm_pt_way USING GIN (tags);
