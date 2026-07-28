-- ============================================================
-- 지식그래프 스타일 분석 레이어 2종 추가 migration
-- analyze 그룹(group_id=2)에 신규 항목만 추가
-- ============================================================

INSERT INTO layer (group_id, key, label, basic, auth, form_type, url) VALUES
    (2, 'regionOdGraph', '지역 OD 관계 그래프', false, 0, 'checkbox', ''),
    (2, 'congestionGraph', '혼잡 전파 그래프', false, 0, 'checkbox', '');
