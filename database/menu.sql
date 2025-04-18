-- 1) 테이블 생성
CREATE TABLE public.menu
(
    menu_id     BIGINT         NOT NULL
        PRIMARY KEY,
    menu_code   VARCHAR(255)   NOT NULL,
    available   CHAR,
    depth       INTEGER,
    insert_date TIMESTAMP(6),
    language    VARCHAR(255),
    name_en     VARCHAR(255),
    name_kor    VARCHAR(255),
    sort_order  INTEGER,
    update_date TIMESTAMP(6),
    parents_id  BIGINT
        CONSTRAINT fk_menu_parents
            REFERENCES public.menu(menu_id)
            ON DELETE SET NULL,
    root_id     BIGINT
        CONSTRAINT fk_menu_root
            REFERENCES public.menu(menu_id)
            ON DELETE SET NULL
);
ALTER TABLE public.menu
    OWNER TO postgres;

-- 2) 시퀀스 생성 (allocationSize=50, CACHE=50)
DROP SEQUENCE IF EXISTS public.menu_id_sequence;
CREATE SEQUENCE public.menu_id_sequence
    START WITH 1
    INCREMENT BY 50
    MINVALUE 1
    CACHE 50;

-- 3) menu_id 기본값으로 시퀀스 연결
ALTER TABLE public.menu
    ALTER COLUMN menu_id
        SET DEFAULT nextval('public.menu_id_sequence');

-- 4) 시퀀스 소유권 설정
ALTER SEQUENCE public.menu_id_sequence
    OWNED BY public.menu.menu_id;

-- 5) 기본 데이터 INSERT (1~35번까지)
INSERT INTO public.menu
(menu_id, menu_code, available, depth, insert_date, language, name_en, name_kor, sort_order, update_date, parents_id, root_id)
VALUES
    (1,  'FILE',               'Y', 0, '2025-04-15 18:48:19.476500', 'ko-KR', 'File',                        '파일',                   1, '2025-04-15 18:48:19.476500', NULL, NULL),
    (2,  'EDIT',               'Y', 0, '2025-04-15 18:48:19.485831', 'ko-KR', 'Edit',                        '편집',                   2, '2025-04-15 18:48:19.485831', NULL, NULL),
    (3,  'SIMULATION',         'Y', 0, '2025-04-15 18:48:19.486381', 'ko-KR', 'Simulation',                  '시뮬레이션',             3, '2025-04-15 18:48:19.486381', NULL, NULL),
    (4,  'NETWORK',            'Y', 1, '2025-04-15 18:48:48.631805', 'ko-KR', 'Network',                     '네트워크',               1, '2025-04-15 18:48:48.631805', 1,      1),
    (5,  'SCENARIO',           'Y', 1, '2025-04-15 18:48:48.632821', 'ko-KR', 'Scenario',                    '시나리오',               2, '2025-04-15 18:48:48.632821', 1,      1),
    (6,  'FACILITY',           'Y', 1, '2025-04-15 18:48:48.633823', 'ko-KR', 'Facility',                    '시설물',                 1, '2025-04-15 18:48:48.633823', 2,      2),
    (7,  'DEMAND',             'Y', 1, '2025-04-15 18:48:48.633823', 'ko-KR', 'Demand',                      '수요',                   2, '2025-04-15 18:48:48.633823', 2,      2),
    (8,  'SCENARIO_EDIT',      'Y', 1, '2025-04-15 18:48:48.634820', 'ko-KR', 'Scenario (Edit)',             '시나리오 (편집)',        3, '2025-04-15 18:48:48.634820', 2,      2),
    (9,  'VEHICLE',            'Y', 1, '2025-04-15 18:48:48.634820', 'ko-KR', 'Vehicle',                     '교통수단',               4, '2025-04-15 18:48:48.634820', 2,      2),
    (10, 'PT_LINE',            'Y', 1, '2025-04-15 18:48:48.634820', 'ko-KR', 'Public Transport Line',       '대중교통 노선',          5, '2025-04-15 18:48:48.634820', 2,      2),
    (11, 'SIMULATION_CONFIG',  'Y', 1, '2025-04-15 18:48:48.634820', 'ko-KR', 'Simulation Config',           '시뮬레이션 설정',        1, '2025-04-15 18:48:48.634820', 3,      3),
    (12, 'NETWORK_IMPORT',     'Y', 2, '2025-04-15 18:48:50.887847', 'ko-KR', 'Network Import',              '네트워크 파일 가져오기', 1, '2025-04-15 18:48:50.888466', 4,      1),
    (13, 'DEMAND_IMPORT',      'Y', 2, '2025-04-15 18:48:50.889005', 'ko-KR', 'Demand Import',               '수요 파일 가져오기',     2, '2025-04-15 18:48:50.889005', 4,      1),
    (14, 'SIGNAL_IMPORT',      'Y', 2, '2025-04-15 18:48:50.889005', 'ko-KR', 'Signal Import',               '신호 파일 가져오기',     3, '2025-04-15 18:48:50.889005', 4,      1),
    (15, 'EXPORT',             'Y', 2, '2025-04-15 18:48:50.889005', 'ko-KR', 'Export',                      '내보내기',              4, '2025-04-15 18:48:50.889005', 4,      1),
    (16, 'ROAD',               'Y', 2, '2025-04-15 18:48:50.889542', 'ko-KR', 'Road',                        '도로',                   1, '2025-04-15 18:48:50.889542', 6,      2),
    (17, 'CONNECTION',         'Y', 2, '2025-04-15 18:48:50.889542', 'ko-KR', 'Connection',                  '커넥션',                 2, '2025-04-15 18:48:50.889542', 6,      2),
    (18, 'PT_BUS_STATION',     'Y', 2, '2025-04-15 18:48:50.889542', 'ko-KR', 'Public Transport Bus Station','대중교통(BUS) 정류장',    3, '2025-04-15 18:48:50.889542', 6,      2),
    (19, 'PT_DRT_STATION',     'Y', 2, '2025-04-15 18:48:50.890069', 'ko-KR', 'Public Transport DRT Station','대중교통(DRT) 정류장',    4, '2025-04-15 18:48:50.890069', 6,      2),
    (20, 'PT_RAIL_STATION',    'Y', 2, '2025-04-15 18:48:50.890069', 'ko-KR', 'Public Transport Rail Station','대중교통(RAIL) 정류장',   5, '2025-04-15 18:48:50.890069', 6,      2),
    (21, 'PT_TRAM_STATION',    'Y', 2, '2025-04-15 18:48:50.890594', 'ko-KR', 'Public Transport TRAM Station','대중교통(TRAM) 정류장',  6, '2025-04-15 18:48:50.890594', 6,      2),
    (22, 'PT_BUS_GARAGE',      'Y', 2, '2025-04-15 18:48:50.890594', 'ko-KR', 'Public Transport Bus Garage','대중교통(BUS) 차고지',    7, '2025-04-15 18:48:50.890594', 6,      2),
    (23, 'PT_TRAM_GARAGE',     'Y', 2, '2025-04-15 18:48:50.890594', 'ko-KR', 'Public Transport TRAM Garage','대중교통(TRAM) 차고지', 8, '2025-04-15 18:48:50.890594', 6,      2),
    (24, 'SIGNAL',             'Y', 2, '2025-04-15 18:48:50.891109', 'ko-KR', 'Signal',                      '신호등',                 9, '2025-04-15 18:48:50.891109', 6,      2),
    (25, 'PAVEMENT_MARKING',   'Y', 2, '2025-04-15 18:48:50.891640', 'ko-KR', 'Pavement Marking',            '노면표시',              10, '2025-04-15 18:48:50.891640', 6,      2),
    (26, 'OD_MATRIX',          'Y', 2, '2025-04-15 18:48:50.891640', 'ko-KR', 'OD Matrix',                   'OD Matrix 설정',         1, '2025-04-15 18:48:50.891640', 7,      2),
    (27, 'AGENT',              'Y', 2, '2025-04-15 18:48:50.892166', 'ko-KR', 'Agent',                       'AGENT 설정',            2, '2025-04-15 18:48:50.892166', 7,      2),
    (28, 'PASSENGER',          'Y', 2, '2025-04-15 18:48:50.892696', 'ko-KR', 'Passenger',                   'PASSENGER 설정',        3, '2025-04-15 18:48:50.892696', 7,      2),
    (29, 'SCENARIO_SETTINGS',  'Y', 2, '2025-04-15 18:48:50.892696', 'ko-KR', 'Scenario Settings',           '시나리오 설정',          1, '2025-04-15 18:48:50.892696', 8,      2),
    (30, 'VEHICLE_TYPE',       'Y', 2, '2025-04-15 18:48:50.893228', 'ko-KR', 'Vehicle Type',                '교통수단 유형',           1, '2025-04-15 18:48:50.893228', 9,      2),
    (31, 'VEHICLE_MODEL',      'Y', 2, '2025-04-15 18:48:50.893765', 'ko-KR', 'Vehicle Model',               '교통수단 2D&3D 모델',     2, '2025-04-15 18:48:50.893765', 9,      2),
    (32, 'BUS_PT_LINE',        'Y', 2, '2025-04-15 18:48:50.893765', 'ko-KR', 'Bus Public Transport Line',   '대중교통(BUS) 노선',      1, '2025-04-15 18:48:50.893765', 10,     2),
    (33, 'RAIL_PT_LINE',       'Y', 2, '2025-04-15 18:48:50.893765', 'ko-KR', 'Rail Public Transport Line',  '대중교통(RAIL) 노선',     2, '2025-04-15 18:48:50.893765', 10,     2),
    (34, 'TRAM_PT_LINE',       'Y', 2, '2025-04-15 18:48:50.894302', 'ko-KR', 'Tram Public Transport Line',  '대중교통(TRAM) 노선',     3, '2025-04-15 18:48:50.894302', 10,     2),
    (35, 'SIMULATION_LEVEL',   'Y', 2, '2025-04-15 18:48:50.894302', 'ko-KR', 'Simulation Level',            '시뮬레이션 레벨 설정',     1, '2025-04-15 18:48:50.894302', 11,     3);