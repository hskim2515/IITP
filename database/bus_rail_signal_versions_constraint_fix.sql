-- bus_station_versions / rail_station_versions / signal_versions UNIQUE 제약조건 추가
--
-- 배경: pavement_marking_versions_constraint_fix.sql 작성 당시 "다른 *_versions
--   테이블(signal_versions, bus_station_versions, rail_station_versions)은 version_role
--   도입 이후 Hibernate ddl-auto로 새로 생성되어 이 문제 없음"이라 판단했으나, 이는 틀린
--   가정이었다 — Hibernate ddl-auto=update는 엔티티에 @Table(uniqueConstraints=...)로
--   명시하지 않는 한 복합(version_id, version_role) UNIQUE 제약을 자동으로 만들지 않는다.
--   세 테이블 모두 실제로는 이 제약이 아예 없는 채로 운영되고 있었다.
--
-- 실측 확인된 실제 피해(2026-08-03, scenario3_1 NextSim 실행 중 발견): BusStationService/
--   RailStationService.saveXxxByVersionId()의 "findByVersionId(조회) → 없으면 새로 생성 →
--   save" 패턴은 두 요청이 거의 동시에(레이스) 들어오면 둘 다 "기존 행 없음"으로 보고 각자
--   새 행을 만들어 version_role='LATEST' 행이 중복 생성될 수 있다. 이 상태에서
--   findByVersionId(단일 결과 기대)가 호출되면 Spring Data JPA가 예외를 던지고, 그 예외가
--   BuildRoadPtLineXml 등 여러 호출부의 try/catch에 조용히 삼켜지면서 "정류장 조회가 항상
--   실패해 노선의 station 매칭이 전부 0건" 같은 원인 불명의 다운스트림 버그로 이어졌다
--   (실측: NextSim PaxRouteGenerator가 "Cannot build OD map ... RoadLinks or RoadStations
--   is empty"로 SIGSEGV). 이미 실제로 중복이 발생해 있던 버전: bus_station_versions의
--   scenario2_2/scenario3_1, rail_station_versions의 test_facility_placement_1785466496/
--   scenario2_2 — 이 마이그레이션 적용 전 반드시 중복 행을 먼저 정리해야 ALTER TABLE이
--   성공한다(아래 DELETE 문 참고, 더 최신 행만 남김).

DELETE FROM bus_station_versions a USING bus_station_versions b
WHERE a.version_id = b.version_id AND a.version_role = b.version_role AND a.id < b.id;

DELETE FROM rail_station_versions a USING rail_station_versions b
WHERE a.version_id = b.version_id AND a.version_role = b.version_role AND a.id < b.id;

DELETE FROM signal_versions a USING signal_versions b
WHERE a.version_id = b.version_id AND a.version_role = b.version_role AND a.id < b.id;

ALTER TABLE bus_station_versions
    ADD CONSTRAINT uq_bus_station_version_role UNIQUE (version_id, version_role);

ALTER TABLE rail_station_versions
    ADD CONSTRAINT uq_rail_station_version_role UNIQUE (version_id, version_role);

ALTER TABLE signal_versions
    ADD CONSTRAINT uq_signal_version_role UNIQUE (version_id, version_role);
