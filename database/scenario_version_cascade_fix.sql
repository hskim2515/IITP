-- scenario_version.scenario_id 외래키 ON DELETE CASCADE 복구
--
-- 배경: scenario.sql의 원본 DDL은 이 외래키를 ON DELETE CASCADE로 정의하지만,
--   개발서버(192.168.10.182:45432) DB는 실제로는 delete_rule=NO ACTION 상태였다
--   (로컬 DB는 정상적으로 CASCADE). 시나리오는 항상 버전이 1개 이상 있으므로
--   DELETE /scenario/{id} 호출 시 자식 scenario_version 행이 남아있는 채로 부모를
--   지우려다 외래키 위반으로 거부되어 500 에러("시나리오 삭제에 실패했습니다") 발생.
--
-- 제약조건 이름은 개발서버에 이미 존재하던 이름(Hibernate 자동 생성)을 그대로 유지.

ALTER TABLE scenario_version DROP CONSTRAINT IF EXISTS fkt359ro7ix4qlv2bcrmgyf6rs4;

ALTER TABLE scenario_version
    ADD CONSTRAINT fkt359ro7ix4qlv2bcrmgyf6rs4
    FOREIGN KEY (scenario_id) REFERENCES scenario(id) ON DELETE CASCADE;
