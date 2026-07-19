-- ============================================================
-- 부천 데이터 레이어 추가 migration
-- busRoute(18), railRoute(19) 는 이미 존재 → 신규 항목만 추가
-- ============================================================

INSERT INTO layer (group_id, key, label, basic, auth) VALUES
    (3, 'busRouteWeekday',    '버스 노선 (평일)',    false, 0),
    (3, 'busRouteWeekend',    '버스 노선 (주말)',    false, 0),
    (3, 'signalTod',          '신호 TOD',           false, 0),
    (3, 'route',              '차량 경로',           false, 0),
    (3, 'paxRoute',           '승객 경로',           false, 0);
