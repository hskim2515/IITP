-- ============================================================
-- 개발서버 DB 마이그레이션 (로컬 스키마 → 개발서버 동기화)
-- 대상: 192.168.10.182:45432/iitp
-- ============================================================

BEGIN;

-- ============================================================
-- 1. layer_group: key='layer' → 'analyze' 수정
-- ============================================================
UPDATE layer_group SET key = 'analyze' WHERE key = 'layer' AND label = '분석';


-- ============================================================
-- 2. layer 테이블: 누락 컬럼 추가 + 데이터 교체
-- ============================================================

-- 누락 컬럼 추가
ALTER TABLE layer ADD COLUMN IF NOT EXISTS form_type TEXT DEFAULT 'checkbox';
ALTER TABLE layer ADD COLUMN IF NOT EXISTS url TEXT DEFAULT '';

-- 기존 데이터 삭제 후 로컬 스키마 기준으로 재삽입
-- layer_schema 관련 테이블도 함께 truncate (모두 비어있음)
TRUNCATE TABLE layer_schema_option, layer_schema_field, layer_schema, layer;

-- baseMap 그룹 (group_id=1)
INSERT INTO layer (id, group_id, key, label, basic, auth, form_type, url) VALUES
(1,  1, 'osm',       'OSM 지도',           false, 0, 'radio', 'https://a.tile.thunderforest.com/transport-dark/{z}/{x}/{y}.png'),
(2,  1, 'base',      'VWorld 일반지도',    false, 0, 'radio', 'http://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/Base/{z}/{y}/{x}.png'),
(3,  1, 'satellite', 'VWorld 위성지도',    false, 0, 'radio', 'http://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/Satellite/{z}/{y}/{x}.jpeg'),
(4,  1, 'hybrid',    'VWorld Hybrid지도',  false, 0, 'radio', 'http://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/Hybrid/{z}/{y}/{x}.png'),
(11, 1, 'midnight',  'VWorld 야간지도',    true,  0, 'radio', 'http://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/midnight/{z}/{y}/{x}.png'),
(32, 1, 'white',      'VWorld 백지도',      false, 0, 'radio', 'http://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/white/{z}/{y}/{x}.png');

-- analyze 그룹 (group_id=2)
INSERT INTO layer (id, group_id, key, label, basic, auth) VALUES
(5,  2, 'heatmap', '히트맵 분석',       false, 0),
(6,  2, 'trip',    '트립플로우 분석',   false, 0),
(10, 2, 'od',      'OD 분석',           false, 0),
(21, 2, 'vehicle', '차량 분석 결과',    true,  0),
(23, 2, 'speed',   '속도 히트맵',       false, 0),
(24, 2, 'traffic', '교통량 히트맵',     false, 0);

-- facility 그룹 (group_id=3)
INSERT INTO layer (id, group_id, key, label, basic, auth) VALUES
(7,  3, 'network',        '도로',           true,  0),
(8,  3, 'signal',         '신호등',         false, 0),
(9,  3, 'busStation',     '버스 정류장',    false, 0),
(12, 3, 'drtStation',     'DRT 정류장',     false, 0),
(13, 3, 'railStation',    'RAIL 정류장',    false, 0),
(14, 3, 'tramStation',    'TRAM 정류장',    false, 0),
(15, 3, 'busGarage',      '버스 차고지',    false, 0),
(16, 3, 'tramGarage',     '트램 차고지',    false, 0),
(17, 3, 'roadMarkings',   '노면표시',       false, 0),
(18, 3, 'busRoute',       '버스 노선',      false, 0),
(19, 3, 'railRoute',      'RAIL 노선',      false, 0),
(20, 3, 'tramRoute',      'TRAM 노선',      false, 0),
(22, 3, 'pavementMarking','노면표시',        false, 0);

-- 시퀀스 최신화
SELECT setval('layer_id_seq', (SELECT MAX(id) FROM layer));


-- ============================================================
-- 3. layer_schema / layer_schema_field / layer_schema_option 삽입
--    (모두 비어있으므로 schema.sql 내용을 그대로 삽입)
-- ============================================================

INSERT INTO layer_schema (id, name, sort_order, status, layer_id) VALUES
(1,  'links',           10, 'ACTIVE',   7),
(2,  'connections',      2, 'ACTIVE',   7),
(3,  'ports',            1, 'ACTIVE',   7),
(4,  'nodes',            0, 'ACTIVE',   7),
(5,  'segments',        13, 'ACTIVE',   7),
(6,  'lanes',           11, 'ACTIVE',   7),
(7,  'cells',           12, 'ACTIVE',   7),
(8,  'busStations',      0, 'ACTIVE',   9),
(9,  'railStations',     0, 'ACTIVE',  13),
(10, 'exits',            0, 'ACTIVE',  13),
(11, 'vehType',          0, 'ACTIVE',  NULL),
(12, 'pavementMarkings', 0, 'ACTIVE',  22),
(13, 'signals',          0, 'ACTIVE',   8);

SELECT setval('layer_schema_id_seq', (SELECT MAX(id) FROM layer_schema));

INSERT INTO layer_schema_field (id, input_type, name, nullable, read_only, sort_order, status, layer_schema_id, default_value) VALUES
(1,  'select',   'type',          true,  false, null, 'ACTIVE',   1,  null),
(2,  'select',   'turning',       true,  false, null, 'ACTIVE',   2,  null),
(3,  'select',   'type',          true,  false, null, 'ACTIVE',   3,  null),
(4,  'select',   'type',          true,  false, null, 'ACTIVE',   4,  null),
(6,  'text',     'featureType',   false, true,  null, 'INACTIVE', 8,  'busStations'),
(7,  'number',   'endPoint',      true,  false, null, 'ACTIVE',   5,  null),
(8,  'number',   'initPoint',     true,  false, null, 'ACTIVE',   5,  null),
(9,  'checkbox', 'block',         true,  false, null, 'ACTIVE',   5,  null),
(10, 'text',     'id',            true,  true,  null, 'ACTIVE',   5,  null),
(11, 'number',   'offset',        true,  false, null, 'ACTIVE',   7,  null),
(12, 'number',   'length',        true,  false, null, 'ACTIVE',   7,  null),
(13, 'text',     'id',            true,  true,  null, 'ACTIVE',   7,  null),
(14, 'textarea', 'shape',         true,  false, null, 'ACTIVE',   6,  null),
(15, 'text',     'rightLaneId',   true,  false, null, 'ACTIVE',   6,  null),
(16, 'text',     'leftLaneId',    true,  false, null, 'ACTIVE',   6,  null),
(17, 'number',   'numCell',       true,  false, null, 'ACTIVE',   6,  null),
(18, 'text',     'id',            true,  true,  null, 'ACTIVE',   6,  null),
(19, 'textarea', 'shape',         true,  false, null, 'ACTIVE',   1,  null),
(20, 'select',   'simType',       true,  false, null, 'ACTIVE',   1,  null),
(21, 'number',   'maxVeh',        true,  false, null, 'ACTIVE',   1,  null),
(22, 'number',   'qmax',          true,  false, null, 'ACTIVE',   1,  null),
(23, 'number',   'waveSpd',       true,  false, null, 'ACTIVE',   1,  null),
(24, 'number',   'minSpd',        true,  false, null, 'ACTIVE',   1,  null),
(25, 'number',   'maxSpd',        true,  false, null, 'ACTIVE',   1,  null),
(26, 'number',   'ffSpd',         true,  false, null, 'ACTIVE',   1,  null),
(27, 'number',   'width',         true,  false, null, 'ACTIVE',   1,  null),
(28, 'number',   'length',        true,  false, null, 'ACTIVE',   1,  null),
(29, 'number',   'stopLine',      true,  false, null, 'ACTIVE',   1,  null),
(30, 'number',   'layer',         true,  false, null, 'ACTIVE',   1,  null),
(31, 'number',   'numLane',       true,  false, null, 'ACTIVE',   1,  null),
(32, 'text',     'toNode',        true,  false, null, 'ACTIVE',   1,  null),
(33, 'text',     'fromNode',      true,  false, null, 'ACTIVE',   1,  null),
(34, 'text',     'id',            true,  true,  null, 'ACTIVE',   1,  null),
(35, 'textarea', 'shape',         true,  false, null, 'ACTIVE',   2,  null),
(36, 'number',   'ffSpd',         true,  false, null, 'ACTIVE',   2,  null),
(37, 'number',   'width',         true,  false, null, 'ACTIVE',   2,  null),
(38, 'number',   'length',        true,  false, null, 'ACTIVE',   2,  null),
(39, 'number',   'toLane',        true,  false, null, 'ACTIVE',   2,  null),
(40, 'text',     'toLink',        true,  false, null, 'ACTIVE',   2,  null),
(41, 'number',   'fromLane',      true,  false, null, 'ACTIVE',   2,  null),
(42, 'text',     'fromLink',      true,  false, null, 'ACTIVE',   2,  null),
(43, 'text',     'id',            true,  true,  null, 'ACTIVE',   2,  null),
(44, 'text',     'direction',     true,  false, null, 'ACTIVE',   3,  null),
(45, 'text',     'linkId',        true,  false, null, 'ACTIVE',   3,  null),
(46, 'text',     'center',        true,  false, null, 'ACTIVE',   4,  null),
(47, 'select',   'v2x',           true,  false, null, 'ACTIVE',   4,  null),
(48, 'number',   'numConnection', true,  false, null, 'ACTIVE',   4,  null),
(49, 'number',   'numPort',       true,  false, null, 'ACTIVE',   4,  null),
(50, 'text',     'id',            true,  true,  null, 'ACTIVE',   4,  null),
(51, 'checkbox', 'rightLc',       true,  false, null, 'ACTIVE',   6,  null),
(52, 'checkbox', 'leftLc',        true,  false, null, 'ACTIVE',   6,  null),
(53, 'text',     'id',            true,  true,  null, 'ACTIVE',   8,  null),
(54, 'select',   'transitMode',   true,  false, null, 'ACTIVE',   8,  'bus'),
(55, 'text',     'linkRef',       true,  false, null, 'ACTIVE',   8,  null),
(56, 'text',     'laneRef',       true,  false, null, 'ACTIVE',   8,  null),
(57, 'number',   'offset',        true,  false, null, 'ACTIVE',   8,  null),
(58, 'select',   'type',          true,  false, null, 'ACTIVE',   8,  null),
(59, 'number',   'parkingLots',   true,  false, null, 'ACTIVE',   8,  null),
(60, 'textarea', 'address',       true,  false, null, 'ACTIVE',   8,  null),
(61, 'textarea', 'center',        true,  false, null, 'ACTIVE',   8,  null),
(62, 'text',     'id',            true,  true,  null, 'ACTIVE',   10, null),
(63, 'text',     'linkRef',       true,  false, null, 'ACTIVE',   10, null),
(64, 'number',   'offset',        true,  false, null, 'ACTIVE',   10, null),
(65, 'number',   'accessTime',    true,  false, null, 'ACTIVE',   10, null),
(66, 'textarea', 'coord',         true,  false, null, 'ACTIVE',   10, null),
(67, 'text',     'id',            true,  true,  null, 'ACTIVE',   9,  null),
(68, 'select',   'transitMode',   true,  false, null, 'ACTIVE',   9,  null),
(69, 'select',   'type',          true,  false, null, 'ACTIVE',   9,  null),
(70, 'textarea', 'address',       true,  false, null, 'ACTIVE',   9,  null),
(71, 'text',     'center',        true,  false, null, 'ACTIVE',   9,  null),
(86, 'text',     'featureType',   false, false, null, 'INACTIVE', 1,  'links'),
(87, 'text',     'featureType',   false, false, null, 'INACTIVE', 4,  'nodes'),
(88, 'text',     'featureType',   false, false, null, 'INACTIVE', 3,  'ports'),
(89, 'text',     'featureType',   false, false, null, 'INACTIVE', 7,  'cells'),
(90, 'text',     'featureType',   false, false, null, 'INACTIVE', 5,  'segments'),
(91, 'text',     'featureType',   false, false, null, 'INACTIVE', 2,  'connections'),
(92, 'text',     'featureType',   false, false, null, 'INACTIVE', 6,  'lanes'),
(247,'textarea', 'lineList',      true,  false, null, 'INACTIVE', 9,  null),
(248,'text',     'id',            false, true,  null, 'ACTIVE',   12, null),
(249,'number',   'angle',         true,  false, null, 'ACTIVE',   12, null),
(250,'number',   'cellId',        true,  false, null, 'ACTIVE',   12, null),
(251,'number',   'laneRef',       true,  false, null, 'ACTIVE',   12, null),
(252,'number',   'linkRef',       true,  false, null, 'ACTIVE',   12, null),
(253,'select',   'markingType',   false, false, null, 'ACTIVE',   12, null),
(254,'number',   'offset',        true,  false, null, 'ACTIVE',   12, null),
(255,'text',     'coordinates',   true,  false, null, 'INACTIVE', 12, null),
(256,'number',   'nodeId',        true,  false, null, 'ACTIVE',   13, null),
(257,'number',   'connectionId',  true,  false, null, 'ACTIVE',   13, null),
(258,'text',     'turning',       true,  false, null, 'ACTIVE',   13, null),
(259,'text',     'type',          true,  false, null, 'ACTIVE',   13, null);

SELECT setval('layer_schema_field_id_seq', (SELECT MAX(id) FROM layer_schema_field));

INSERT INTO layer_schema_option (id, value, field_id) VALUES
(1,  'straight',     1),
(2,  'L',            2),
(3,  'S',            2),
(4,  'R',            2),
(5,  'in',           3),
(6,  'out',          3),
(7,  'terminal',     4),
(8,  'intersection', 4),
(9,  'normal',       4),
(10, 'diverging',    4),
(11, 'merging',      4),
(12, 'garage',       4),
(13, 'curve',        1),
(14, 'Meso',         20),
(15, 'Micro',        20),
(16, 'on',           47),
(17, 'off',          47),
(20, 'test',         1),
(21, 'subway',       68),
(22, 'island',       69),
(23, 'side',         69),
(24, 'Diamond',      253),
(25, 'LeftTurn',     253),
(26, 'RightTurn',    253),
(27, 'Straight',     253),
(28, 'StraightLeft', 253),
(29, 'StraightRight',253),
(30, 'UTurn',        253),
(31, 'side',         58),
(32, 'island',       58),
(33, 'bus',          54);

SELECT setval('layer_schema_option_id_seq', (SELECT MAX(id) FROM layer_schema_option));

-- layer_schema_config / config_option 삽입 (없으면)
INSERT INTO layer_schema_config (id, config_key, input_type, sort_order)
SELECT 1, 'name', 'text', 1 WHERE NOT EXISTS (SELECT 1 FROM layer_schema_config WHERE id=1);
INSERT INTO layer_schema_config (id, config_key, input_type, sort_order)
SELECT 2, 'inputType', 'select', 2 WHERE NOT EXISTS (SELECT 1 FROM layer_schema_config WHERE id=2);
INSERT INTO layer_schema_config (id, config_key, input_type, sort_order)
SELECT 3, 'readOnly', 'select', 3 WHERE NOT EXISTS (SELECT 1 FROM layer_schema_config WHERE id=3);
INSERT INTO layer_schema_config (id, config_key, input_type, sort_order)
SELECT 4, 'nullable', 'select', 4 WHERE NOT EXISTS (SELECT 1 FROM layer_schema_config WHERE id=4);
INSERT INTO layer_schema_config (id, config_key, input_type, sort_order)
SELECT 5, 'status', 'select', 5 WHERE NOT EXISTS (SELECT 1 FROM layer_schema_config WHERE id=5);
INSERT INTO layer_schema_config (id, config_key, input_type, sort_order)
SELECT 6, 'options', 'tags', 6 WHERE NOT EXISTS (SELECT 1 FROM layer_schema_config WHERE id=6);
INSERT INTO layer_schema_config (id, config_key, input_type, sort_order)
SELECT 7, 'defaultValue', 'text', 7 WHERE NOT EXISTS (SELECT 1 FROM layer_schema_config WHERE id=7);


-- ============================================================
-- 4. menu 테이블: 데이터 동기화 (로컬 기준)
--    - ID 1-15: 로컬과 동일 (변경 불필요)
--    - ID 16-34: menu_code 및 내용이 다름 → UPDATE
--    - ID 35: 로컬에 없는 행 → DELETE
--    - ID 38-44: 로컬에만 있음 → INSERT
-- ============================================================

-- ID 16-34 UPDATE (로컬 menu.sql 기준)
UPDATE menu SET menu_code='NETWORK',          name_en='Network',                         name_kor='도로',                     sort_order=1,  parents_id=6,  root_id=2 WHERE menu_id=16;
UPDATE menu SET menu_code='BUS_STATION',      name_en='Public Transport Bus Station',    name_kor='대중교통(BUS) 정류장',     sort_order=3,  parents_id=6,  root_id=2 WHERE menu_id=17;
UPDATE menu SET menu_code='DRT_STATION',      name_en='Public Transport DRT Station',    name_kor='대중교통(DRT) 정류장',     sort_order=4,  parents_id=6,  root_id=2 WHERE menu_id=18;
UPDATE menu SET menu_code='RAIL_STATION',     name_en='Public Transport Rail Station',   name_kor='대중교통(RAIL) 정류장',    sort_order=5,  parents_id=6,  root_id=2 WHERE menu_id=19;
UPDATE menu SET menu_code='TRAM_STATION',     name_en='Public Transport TRAM Station',   name_kor='대중교통(TRAM) 정류장',    sort_order=6,  parents_id=6,  root_id=2 WHERE menu_id=20;
UPDATE menu SET menu_code='BUS_GARAGE',       name_en='Public Transport Bus Garage',     name_kor='대중교통(BUS) 차고지',     sort_order=7,  parents_id=6,  root_id=2 WHERE menu_id=21;
UPDATE menu SET menu_code='TRAM_GARAGE',      name_en='Public Transport TRAM Garage',    name_kor='대중교통(TRAM) 차고지',    sort_order=8,  parents_id=6,  root_id=2 WHERE menu_id=22;
UPDATE menu SET menu_code='SIGNAL',           name_en='Signal',                          name_kor='신호등',                   sort_order=9,  parents_id=6,  root_id=2 WHERE menu_id=23;
UPDATE menu SET menu_code='PAVEMENT_MARKING', name_en='Pavement Marking',                name_kor='노면표시',                  sort_order=10, parents_id=6,  root_id=2 WHERE menu_id=24;
UPDATE menu SET menu_code='OD_MATRIX',        name_en='OD Matrix',                       name_kor='OD Matrix 설정',           sort_order=1,  parents_id=7,  root_id=2 WHERE menu_id=25;
UPDATE menu SET menu_code='AGENT',            name_en='Agent',                           name_kor='AGENT 설정',               sort_order=2,  parents_id=7,  root_id=2 WHERE menu_id=26;
UPDATE menu SET menu_code='PASSENGER',        name_en='Passenger',                       name_kor='PASSENGER 설정',           sort_order=3,  parents_id=7,  root_id=2 WHERE menu_id=27;
UPDATE menu SET menu_code='SCENARIO_SETTINGS',name_en='Scenario Settings',               name_kor='시나리오 설정',             sort_order=1,  parents_id=8,  root_id=2 WHERE menu_id=28;
UPDATE menu SET menu_code='VEHICLE_TYPE',     name_en='Vehicle Type',                    name_kor='교통수단 유형',             sort_order=1,  parents_id=9,  root_id=2 WHERE menu_id=29;
UPDATE menu SET menu_code='VEHICLE_MODEL',    name_en='Vehicle Model',                   name_kor='교통수단 2D&3D 모델',       sort_order=2,  parents_id=9,  root_id=2 WHERE menu_id=30;
UPDATE menu SET menu_code='BUS_PT_LINE',      name_en='Bus Public Transport Line',       name_kor='대중교통(BUS) 노선',        sort_order=1,  parents_id=10, root_id=2 WHERE menu_id=31;
UPDATE menu SET menu_code='RAIL_PT_LINE',     name_en='Rail Public Transport Line',      name_kor='대중교통(RAIL) 노선',       sort_order=2,  parents_id=10, root_id=2 WHERE menu_id=32;
UPDATE menu SET menu_code='TRAM_PT_LINE',     name_en='Tram Public Transport Line',      name_kor='대중교통(TRAM) 노선',       sort_order=3,  parents_id=10, root_id=2 WHERE menu_id=33;
UPDATE menu SET menu_code='SIMULATION_LEVEL', name_en='Simulation Level',                name_kor='시뮬레이션 레벨 설정',      sort_order=1,  parents_id=11, root_id=3 WHERE menu_id=34;

-- ID 35: 로컬에 없는 행 삭제
DELETE FROM menu WHERE menu_id = 35;

-- ID 38-44: 로컬에만 있는 행 삽입
INSERT INTO menu (menu_id, menu_code, available, depth, language, name_en, name_kor, sort_order, parents_id, root_id, created_by, created_date, last_modified_by, last_modified_date)
VALUES
(38, 'SCHEMA_SETTING',          'Y', 1, 'ko-KR', 'Schema Setting',          '스키마 설정',        1, 1,  1, 'system', NOW(), 'system', NOW()),
(39, 'SCHEMA_NETWORK',          'Y', 2, 'ko-KR', 'Network Schema',          '도로 스키마',        1, 38, 1, 'system', NOW(), 'system', NOW()),
(40, 'SCHEMA_BUS_STATION',      'Y', 2, 'ko-KR', 'Bus Station Schema',      'BUS 정류장 스키마',  2, 38, 1, 'system', NOW(), 'system', NOW()),
(41, 'SCHEMA_DRT_STATION',      'Y', 2, 'ko-KR', 'DRT Station Schema',      'DRT 정류장 스키마',  3, 38, 1, 'system', NOW(), 'system', NOW()),
(42, 'SCHEMA_RAIL_STATION',     'Y', 2, 'ko-KR', 'Rail Station Schema',     'RAIL 정류장 스키마', 4, 38, 1, 'system', NOW(), 'system', NOW()),
(43, 'SCHEMA_TRAM_STATION',     'Y', 2, 'ko-KR', 'Tram Station Schema',     'TRAM 정류장 스키마', 5, 38, 1, 'system', NOW(), 'system', NOW()),
(44, 'SCHEMA_PAVEMENT_MARKING', 'Y', 2, 'ko-KR', 'Pavement Marking Schema', '노면표시 스키마',    6, 38, 1, 'system', NOW(), 'system', NOW())
ON CONFLICT (menu_id) DO NOTHING;

COMMIT;

-- ── KTDB 공간 인덱스 (2026-07-02) ───────────────────────────────────────────
-- ktdb_node(lat, lon) 복합 인덱스 — 타일 bbox 조회 9배 성능 향상
CREATE INDEX IF NOT EXISTS idx_ktdb_node_lat_lon ON ktdb_node (lat, lon);
-- f_node / t_node 인덱스 (ktdb_import.sh에 이미 포함, 기존 DB 대상 보정)
CREATE INDEX IF NOT EXISTS idx_ktdb_link_f_node  ON ktdb_link (f_node);
CREATE INDEX IF NOT EXISTS idx_ktdb_link_t_node  ON ktdb_link (t_node);
