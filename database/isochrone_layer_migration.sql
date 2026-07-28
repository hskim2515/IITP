-- ============================================================
-- 등시선(isochrone) 접근성 지도 레이어 추가 migration
-- analyze 그룹(group_id=2)에 신규 항목만 추가
-- ============================================================

INSERT INTO layer (group_id, key, label, basic, auth, form_type, url) VALUES
    (2, 'isochrone', '시설 서비스권 분석', false, 0, 'checkbox', '');
