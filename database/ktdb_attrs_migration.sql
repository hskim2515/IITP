-- 표준노드링크 원본 속성 보존 확장 마이그레이션
-- (ktdb_import.sh 재실행 없이 기존 DB 스키마만 맞추는 용도.
--  신규 컬럼 값은 기본값으로 채워지므로, 실제 속성값을 쓰려면
--  bash database/ktdb_import.sh 로 원본 SHP에서 재적재해야 한다.)

-- ktdb_node: 노드유형/교차로명/회전제한 플래그
ALTER TABLE ktdb_node ADD COLUMN IF NOT EXISTS node_type VARCHAR(3)  NOT NULL DEFAULT '';
ALTER TABLE ktdb_node ADD COLUMN IF NOT EXISTS node_name VARCHAR(50) NOT NULL DEFAULT '';
ALTER TABLE ktdb_node ADD COLUMN IF NOT EXISTS turn_p    VARCHAR(1)  NOT NULL DEFAULT '0';

-- ktdb_link: 구조물유형/노선번호/연결로/사용여부/중용/통행제한
ALTER TABLE ktdb_link ADD COLUMN IF NOT EXISTS road_type  VARCHAR(3) NOT NULL DEFAULT '000';
ALTER TABLE ktdb_link ADD COLUMN IF NOT EXISTS road_no    VARCHAR(5) NOT NULL DEFAULT '';
ALTER TABLE ktdb_link ADD COLUMN IF NOT EXISTS connect    VARCHAR(3) NOT NULL DEFAULT '0';
ALTER TABLE ktdb_link ADD COLUMN IF NOT EXISTS road_use   VARCHAR(1) NOT NULL DEFAULT '0';
ALTER TABLE ktdb_link ADD COLUMN IF NOT EXISTS multi_link VARCHAR(1) NOT NULL DEFAULT '0';
ALTER TABLE ktdb_link ADD COLUMN IF NOT EXISTS rest_veh   VARCHAR(3) NOT NULL DEFAULT '0';
ALTER TABLE ktdb_link ADD COLUMN IF NOT EXISTS rest_w     INTEGER    NOT NULL DEFAULT 0;
ALTER TABLE ktdb_link ADD COLUMN IF NOT EXISTS rest_h     INTEGER    NOT NULL DEFAULT 0;

-- ktdb_turninfo: 회전정보 (엔티티는 있었으나 적재 스크립트에 없던 테이블)
CREATE TABLE IF NOT EXISTS ktdb_turninfo (
    node_id   VARCHAR(20) NOT NULL,
    st_link   VARCHAR(20) NOT NULL,
    ed_link   VARCHAR(20) NOT NULL,
    turn_type VARCHAR(10),
    turn_oper VARCHAR(1)  NOT NULL DEFAULT '0',
    PRIMARY KEY (node_id, st_link, ed_link)
);
CREATE INDEX IF NOT EXISTS idx_ktdb_turninfo_node ON ktdb_turninfo (node_id);

-- ktdb_multilink: 중용구간 노선정보 (참조용)
CREATE TABLE IF NOT EXISTS ktdb_multilink (
    link_id   VARCHAR(20) NOT NULL,
    multi_id  INTEGER,
    road_rank VARCHAR(3),
    road_type VARCHAR(3),
    road_no   VARCHAR(5),
    road_name VARCHAR(30)
);
CREATE INDEX IF NOT EXISTS idx_ktdb_multilink_link ON ktdb_multilink (link_id);
