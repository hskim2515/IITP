-- ============================================================
-- CI/CD 동기화 스크립트: menu, layer_col_scheme
-- 매 배포 시 실행 — idempotent (반복 실행 안전)
-- ============================================================

BEGIN;

-- ── menu ────────────────────────────────────────────────────
-- self-reference(parents_id, root_id)만 존재, 외부 FK 없음
TRUNCATE TABLE menu RESTART IDENTITY CASCADE;

INSERT INTO menu (menu_id, menu_code, available, access_role, depth, language, name_en, name_kor, sort_order, parents_id, root_id, created_by, created_date, last_modified_by, last_modified_date) VALUES
  (1,  'FILE',               'Y', null, 0, 'ko-KR', 'File',                          '파일',                     1,  null, null, 'system', now(), 'system', now()),
  (2,  'EDIT',               'Y', null, 0, 'ko-KR', 'Edit',                          '편집',                     2,  null, null, 'system', now(), 'system', now()),
  (3,  'SIMULATION',         'Y', null, 0, 'ko-KR', 'Simulation',                    '시뮬레이션',               3,  null, null, 'system', now(), 'system', now()),
  (4,  'NETWORK',            'Y', null, 1, 'ko-KR', 'Network',                       '네트워크',                 1,  1,    1,    'system', now(), 'system', now()),
  (5,  'SCENARIO',           'Y', null, 1, 'ko-KR', 'Scenario',                      '시나리오',                 2,  1,    1,    'system', now(), 'system', now()),
  (6,  'FACILITY',           'Y', null, 1, 'ko-KR', 'Facility',                      '시설물',                   1,  2,    2,    'system', now(), 'system', now()),
  (7,  'DEMAND',             'Y', null, 1, 'ko-KR', 'Demand',                        '수요',                     2,  2,    2,    'system', now(), 'system', now()),
  (8,  'SCENARIO_EDIT',      'Y', null, 1, 'ko-KR', 'Scenario (Edit)',               '시나리오 (편집)',           3,  2,    2,    'system', now(), 'system', now()),
  (9,  'VEHICLE',            'Y', null, 1, 'ko-KR', 'Vehicle',                       '교통수단',                 4,  2,    2,    'system', now(), 'system', now()),
  (10, 'PT_LINE',            'Y', null, 1, 'ko-KR', 'Public Transport Line',         '대중교통 노선',             5,  2,    2,    'system', now(), 'system', now()),
  (11, 'SIMULATION_CONFIG',  'Y', null, 1, 'ko-KR', 'Simulation Config',             '시뮬레이션 설정',           1,  3,    3,    'system', now(), 'system', now()),
  (12, 'NETWORK_IMPORT',     'Y', null, 2, 'ko-KR', 'Network Import',                '네트워크 파일 가져오기',    1,  4,    1,    'system', now(), 'system', now()),
  (13, 'DEMAND_IMPORT',      'Y', null, 2, 'ko-KR', 'Demand Import',                 '수요 파일 가져오기',        2,  4,    1,    'system', now(), 'system', now()),
  (14, 'SIGNAL_IMPORT',      'Y', null, 2, 'ko-KR', 'Signal Import',                 '신호 파일 가져오기',        3,  4,    1,    'system', now(), 'system', now()),
  (15, 'EXPORT',             'Y', null, 2, 'ko-KR', 'Export',                        '내보내기',                 4,  4,    1,    'system', now(), 'system', now()),
  (16, 'NETWORK',            'Y', null, 2, 'ko-KR', 'Network',                       '도로',                     1,  6,    2,    'system', now(), 'system', now()),
  (17, 'BUS_STATION',        'Y', null, 2, 'ko-KR', 'Public Transport Bus Station',  '대중교통(BUS) 정류장',      3,  6,    2,    'system', now(), 'system', now()),
  (18, 'DRT_STATION',        'Y', null, 2, 'ko-KR', 'Public Transport DRT Station',  '대중교통(DRT) 정류장',      4,  6,    2,    'system', now(), 'system', now()),
  (19, 'RAIL_STATION',       'Y', null, 2, 'ko-KR', 'Public Transport Rail Station', '대중교통(RAIL) 정류장',     5,  6,    2,    'system', now(), 'system', now()),
  (20, 'TRAM_STATION',       'Y', null, 2, 'ko-KR', 'Public Transport TRAM Station', '대중교통(TRAM) 정류장',     6,  6,    2,    'system', now(), 'system', now()),
  (21, 'BUS_GARAGE',         'Y', null, 2, 'ko-KR', 'Public Transport Bus Garage',   '대중교통(BUS) 차고지',      7,  6,    2,    'system', now(), 'system', now()),
  (22, 'TRAM_GARAGE',        'Y', null, 2, 'ko-KR', 'Public Transport TRAM Garage',  '대중교통(TRAM) 차고지',     8,  6,    2,    'system', now(), 'system', now()),
  (23, 'SIGNAL',             'Y', null, 2, 'ko-KR', 'Signal',                        '신호등',                   9,  6,    2,    'system', now(), 'system', now()),
  (24, 'PAVEMENT_MARKING',   'Y', null, 2, 'ko-KR', 'Pavement Marking',              '노면표시',                 10, 6,    2,    'system', now(), 'system', now()),
  (25, 'OD_MATRIX',          'Y', null, 2, 'ko-KR', 'OD Matrix',                     'OD Matrix 설정',            1,  7,    2,    'system', now(), 'system', now()),
  (26, 'AGENT',              'Y', null, 2, 'ko-KR', 'Agent',                         'AGENT 설정',                2,  7,    2,    'system', now(), 'system', now()),
  (27, 'PASSENGER',          'Y', null, 2, 'ko-KR', 'Passenger',                     'PASSENGER 설정',            3,  7,    2,    'system', now(), 'system', now()),
  (28, 'SCENARIO_SETTINGS',  'Y', null, 2, 'ko-KR', 'Scenario Settings',             '시나리오 설정',             1,  8,    2,    'system', now(), 'system', now()),
  (29, 'VEHICLE_TYPE',       'Y', null, 2, 'ko-KR', 'Vehicle Type',                  '교통수단 유형',             1,  9,    2,    'system', now(), 'system', now()),
  (30, 'VEHICLE_MODEL',      'Y', null, 2, 'ko-KR', 'Vehicle Model',                 '교통수단 2D&3D 모델',        2,  9,    2,    'system', now(), 'system', now()),
  (31, 'BUS_PT_LINE',        'Y', null, 2, 'ko-KR', 'Bus Public Transport Line',     '대중교통(BUS) 노선',         1,  10,   2,    'system', now(), 'system', now()),
  (32, 'RAIL_PT_LINE',       'Y', null, 2, 'ko-KR', 'Rail Public Transport Line',    '대중교통(RAIL) 노선',        2,  10,   2,    'system', now(), 'system', now()),
  (33, 'TRAM_PT_LINE',       'Y', null, 2, 'ko-KR', 'Tram Public Transport Line',    '대중교통(TRAM) 노선',        3,  10,   2,    'system', now(), 'system', now()),
  (34, 'SIMULATION_LEVEL',   'Y', null, 2, 'ko-KR', 'Simulation Level',              '시뮬레이션 레벨 설정',       1,  11,   3,    'system', now(), 'system', now()),
  (38, 'SCHEMA_SETTING',     'Y', null, 1, 'ko-KR', 'Schema Setting',                '스키마 설정',               1,  1,    1,    'system', now(), 'system', now()),
  (39, 'SCHEMA_NETWORK',     'Y', null, 2, 'ko-KR', 'Network Schema',                '도로 스키마',               1,  38,   1,    'system', now(), 'system', now()),
  (40, 'SCHEMA_BUS_STATION', 'Y', null, 2, 'ko-KR', 'Bus Station Schema',            'BUS 정류장 스키마',          2,  38,   1,    'system', now(), 'system', now()),
  (41, 'SCHEMA_DRT_STATION', 'Y', null, 2, 'ko-KR', 'DRT Station Schema',            'DRT 정류장 스키마',          3,  38,   1,    'system', now(), 'system', now()),
  (42, 'SCHEMA_RAIL_STATION','Y', null, 2, 'ko-KR', 'Rail Station Schema',           'RAIL 정류장 스키마',         4,  38,   1,    'system', now(), 'system', now()),
  (43, 'SCHEMA_TRAM_STATION','Y', null, 2, 'ko-KR', 'Tram Station Schema',           'TRAM 정류장 스키마',         5,  38,   1,    'system', now(), 'system', now()),
  (44, 'SCHEMA_PAVEMENT_MARKING','Y',null,2,'ko-KR','Pavement Marking Schema',       '노면표시 스키마',            6,  38,   1,    'system', now(), 'system', now());

-- identity sequence를 마지막 삽입 ID에 맞게 재설정
SELECT setval(pg_get_serial_sequence('menu', 'menu_id'), MAX(menu_id)) FROM menu;


-- ── layer_col_scheme ─────────────────────────────────────────
TRUNCATE TABLE layer_col_scheme RESTART IDENTITY CASCADE;

INSERT INTO layer_col_scheme (row_key, layer_key, key, readonly, type, options) VALUES
  -- link
  ('link', 'network', 'id',        true,  'number', NULL),
  ('link', 'network', 'fromNode',  true,  'text',   NULL),
  ('link', 'network', 'toNode',    true,  'text',   NULL),
  ('link', 'network', 'ffSpd',     false, 'number', NULL),
  ('link', 'network', 'maxSpd',    false, 'number', NULL),
  ('link', 'network', 'minSpd',    false, 'number', NULL),
  ('link', 'network', 'maxVeh',    false, 'number', NULL),
  ('link', 'network', 'qmax',      false, 'number', NULL),
  ('link', 'network', 'waveSpd',   false, 'number', NULL),
  ('link', 'network', 'length',    false, 'number', NULL),
  ('link', 'network', 'numLane',   true,  'number', NULL),
  ('link', 'network', 'width',     false, 'number', NULL),
  ('link', 'network', 'stopLine',  false, 'number', NULL),
  ('link', 'network', 'type',      false, 'select', ARRAY['straight']),
  ('link', 'network', 'simType',   false, 'number', NULL),
  ('link', 'network', 'shape',     true,  'text',   NULL),
  ('link', 'network', 'layer',     true,  'text',   NULL),
  -- lane
  ('lane', 'network', 'id',          true, 'text',   NULL),
  ('lane', 'network', 'numCell',     true, 'number', NULL),
  ('lane', 'network', 'leftLaneId',  true, 'text',   NULL),
  ('lane', 'network', 'rightLaneId', true, 'text',   NULL),
  ('lane', 'network', 'shape',       true, 'text',   NULL),
  -- cell
  ('cell', 'network', 'id',     true,  'text',   NULL),
  ('cell', 'network', 'length', false, 'number', NULL),
  ('cell', 'network', 'offset', false, 'number', NULL),
  -- segment
  ('segment', 'network', 'id',        true,  'text',    NULL),
  ('segment', 'network', 'block',     false, 'boolean', NULL),
  ('segment', 'network', 'initPoint', false, 'number',  NULL),
  ('segment', 'network', 'endPoint',  false, 'number',  NULL),
  ('segment', 'network', 'leftLc',    false, 'text',    NULL),
  ('segment', 'network', 'rightLc',   false, 'text',    NULL),
  -- nodes
  ('nodes', 'network', 'id',            true,  'text',   NULL),
  ('nodes', 'network', 'center',        true,  'text',   NULL),
  ('nodes', 'network', 'numConnection', true,  'number', NULL),
  ('nodes', 'network', 'numPort',       true,  'number', NULL),
  ('nodes', 'network', 'type',          false, 'select', ARRAY['intersection','terminal','normal','merging','diverging','garage']),
  -- connections
  ('connections', 'network', 'id',       true,  'text',   NULL),
  ('connections', 'network', 'fromLink', true,  'text',   NULL),
  ('connections', 'network', 'fromLane', true,  'number', NULL),
  ('connections', 'network', 'toLink',   true,  'text',   NULL),
  ('connections', 'network', 'toLane',   true,  'number', NULL),
  ('connections', 'network', 'ffSpd',    false, 'number', NULL),
  ('connections', 'network', 'length',   true,  'number', NULL),
  ('connections', 'network', 'width',    false, 'number', NULL),
  ('connections', 'network', 'shape',    true,  'text',   NULL),
  ('connections', 'network', 'turning',  false, 'select', ARRAY['S','L','R','U']),
  -- ports
  ('ports', 'network', 'linkId',    true, 'text',   NULL),
  ('ports', 'network', 'type',      true, 'select', ARRAY['in','out']),
  ('ports', 'network', 'direction', true, 'text',   NULL);

COMMIT;
