-- ============================================================
-- 링크 혼잡도(V/C)/서비스수준(LOS)/병목 링크 분석 레이어 추가 migration
-- analyze 그룹(group_id=2)에 신규 항목만 추가 — 이미 실행된 layer.sql/migration_dev.sql 대상 DB에 적용
-- ============================================================

INSERT INTO layer (group_id, key, label, basic, auth, form_type, url) VALUES
    (2, 'congestion', '혼잡도 히트맵',   false, 0, 'checkbox', ''),
    (2, 'los',        '서비스수준(LOS)', false, 0, 'checkbox', ''),
    (2, 'bottleneck', '병목 링크',       false, 0, 'checkbox', '');
