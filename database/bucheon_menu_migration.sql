-- ============================================================
-- 부천 네트워크 데이터 대응 메뉴 추가 migration
-- 기준 데이터: /1_bucheon network/network_xml_bucheon/
-- ============================================================
-- 추가 메뉴:
--   45. SIGNAL_TOD      - signalTOD.xml  → 편집 > 시설물 > 신호 TOD
--   46. SIMULATION_SCENARIO - scenario.xml → 시뮬레이션 > 시뮬레이션 설정 > 시뮬레이션 시나리오
--   47. BUS_PT_LINE_WEEKDAY - roadPTline - weekday.xml → 편집 > 대중교통 노선 > 버스 노선 (평일)
--   48. BUS_PT_LINE_WEEKEND - roadPTline - weekend.xml → 편집 > 대중교통 노선 > 버스 노선 (주말)
--   49. ROUTE           - Route.json     → 편집 > 수요 > 차량 경로
--   50. PAX_ROUTE       - PaxRoute.json  → 편집 > 수요 > 승객 경로
-- ============================================================

-- 45. 신호 TOD (signalTOD.xml)
--     부모: FACILITY (id=6, root=2), SIGNAL(id=23) 다음 sort_order=11
INSERT INTO iitp.public.menu (menu_id, menu_code, available, access_role, depth, language, name_en, name_kor, sort_order, parents_id, root_id, created_by, created_date, last_modified_by, last_modified_date)
VALUES (46, 'SIGNAL_TOD', 'Y', null, 2, 'ko-KR', 'Signal TOD', '신호 TOD', 11, 6, 2, 'system', now(), 'system', now());

-- 46. 시뮬레이션 시나리오 (scenario.xml - 시뮬 실행 파라미터)
--     부모: SIMULATION_CONFIG (id=11, root=3), sort_order=2
INSERT INTO iitp.public.menu (menu_id, menu_code, available, access_role, depth, language, name_en, name_kor, sort_order, parents_id, root_id, created_by, created_date, last_modified_by, last_modified_date)
VALUES (47, 'SIMULATION_SCENARIO', 'Y', null, 2, 'ko-KR', 'Simulation Scenario', '시뮬레이션 시나리오', 2, 11, 3, 'system', now(), 'system', now());

-- 47. 버스 노선 (평일) (roadPTline - weekday.xml)
--     부모: PT_LINE (id=10, root=2), BUS_PT_LINE(id=31, sort=1) 다음 sort_order=2
INSERT INTO iitp.public.menu (menu_id, menu_code, available, access_role, depth, language, name_en, name_kor, sort_order, parents_id, root_id, created_by, created_date, last_modified_by, last_modified_date)
VALUES (48, 'BUS_PT_LINE_WEEKDAY', 'Y', null, 2, 'ko-KR', 'Bus PT Line (Weekday)', '대중교통(BUS) 노선 (평일)', 2, 10, 2, 'system', now(), 'system', now());

-- 48. 버스 노선 (주말) (roadPTline - weekend.xml)
--     부모: PT_LINE (id=10, root=2), sort_order=3
INSERT INTO iitp.public.menu (menu_id, menu_code, available, access_role, depth, language, name_en, name_kor, sort_order, parents_id, root_id, created_by, created_date, last_modified_by, last_modified_date)
VALUES (49, 'BUS_PT_LINE_WEEKEND', 'Y', null, 2, 'ko-KR', 'Bus PT Line (Weekend)', '대중교통(BUS) 노선 (주말)', 3, 10, 2, 'system', now(), 'system', now());

-- 기존 RAIL_PT_LINE, TRAM_PT_LINE sort_order 밀림 보정
UPDATE iitp.public.menu SET sort_order = 4 WHERE menu_id = 32;  -- RAIL_PT_LINE
UPDATE iitp.public.menu SET sort_order = 5 WHERE menu_id = 33;  -- TRAM_PT_LINE

-- 49. 차량 경로 (Route.json)
--     부모: DEMAND (id=7, root=2), sort_order=4
INSERT INTO iitp.public.menu (menu_id, menu_code, available, access_role, depth, language, name_en, name_kor, sort_order, parents_id, root_id, created_by, created_date, last_modified_by, last_modified_date)
VALUES (50, 'ROUTE', 'Y', null, 2, 'ko-KR', 'Vehicle Route', '차량 경로', 4, 7, 2, 'system', now(), 'system', now());

-- 50. 승객 경로 (PaxRoute.json)
--     부모: DEMAND (id=7, root=2), sort_order=5
INSERT INTO iitp.public.menu (menu_id, menu_code, available, access_role, depth, language, name_en, name_kor, sort_order, parents_id, root_id, created_by, created_date, last_modified_by, last_modified_date)
VALUES (51, 'PAX_ROUTE', 'Y', null, 2, 'ko-KR', 'Passenger Route', '승객 경로', 5, 7, 2, 'system', now(), 'system', now());
