-- pavement_marking_versions UNIQUE 제약조건 수정
--
-- 배경: PavementMarkingVersion이 BaseVersion(ORIGIN/LATEST 두 개의 version_role 행)을
--   사용하도록 리팩토링되었으나, 기존 덤프(pavement_marking.sql)에서 생성된
--   uq_version_id UNIQUE(version_id) 제약조건이 그대로 남아있어
--   동일 version_id에 ORIGIN/LATEST 두 행을 저장할 수 없는 상태였음.
--   (PavementMarkingService.getDataFromXml() 최초 호출 시
--    "duplicate key value violates unique constraint uq_version_id" 500 에러 발생)
--
-- 다른 *_versions 테이블(signal_versions, bus_station_versions, rail_station_versions)은
-- version_role 도입 이후 Hibernate ddl-auto로 새로 생성되어 이 문제 없음.

ALTER TABLE pavement_marking_versions DROP CONSTRAINT IF EXISTS uq_version_id;

ALTER TABLE pavement_marking_versions
    ADD CONSTRAINT uq_pavement_marking_version_role UNIQUE (version_id, version_role);
