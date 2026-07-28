-- ============================================================
-- 행정구역(시도/시군구/읍면동) 기반 교통량 레이어 추가 migration
-- analyze 그룹(group_id=2)에 신규 항목만 추가
-- ============================================================

INSERT INTO layer (group_id, key, label, basic, auth, form_type, url) VALUES
    (2, 'region', '지역별 교통량(행정구역)', false, 0, 'checkbox', '');
