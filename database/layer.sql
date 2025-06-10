-- 시퀀스 생성
CREATE SEQUENCE layer_group_id_seq START 1;
CREATE SEQUENCE layer_id_seq START 1;

-- layer_group 테이블
CREATE TABLE layer_group (
                             id INTEGER PRIMARY KEY DEFAULT nextval('layer_group_id_seq'),
                             key TEXT UNIQUE NOT NULL,
                             label TEXT NOT NULL
);

-- layer 테이블
CREATE TABLE layer (
                       id INTEGER PRIMARY KEY DEFAULT nextval('layer_id_seq'),
                       group_id INTEGER NOT NULL REFERENCES layer_group(id) ON DELETE CASCADE,
                       key TEXT NOT NULL,
                       label VARCHAR(255) NOT NULL DEFAULT '',
                       basic BOOLEAN DEFAULT FALSE,
                       auth INTEGER USING 0
);

-- layer_group 삽입
INSERT INTO layer_group (key, label) VALUES
                                         ('baseMap', '배경지도'),
                                         ('layer', '분석'),
                                         ('facility', '시설물');

-- baseMap 그룹
INSERT INTO layer (id, group_id, key, label, basic, auth) VALUES
                                                              (1, 1, 'osm',       'OSM 지도',            false, 0),
                                                              (2, 1, 'base',      'VWorld 일반지도',     false,  0),
                                                              (3, 1, 'satellite', 'VWorld 위성지도',     false, 0),
                                                              (4, 1, 'hybrid',    'VWorld Hybrid지도',   false, 0),
                                                              (11, 1, 'midnight',    'VWorld 야간지도',   true, 0);

-- layer 그룹
INSERT INTO layer (id, group_id, key, label, basic, auth) VALUES
                                                              (5, 2, 'heatmap', '히트맵 분석',        false, 0),
                                                              (6, 2, 'trip',    '트립플로우 분석',    false, 0),
                                                              (10, 2, 'od',    'OD 분석',    false, 0);

-- facility 그룹
INSERT INTO layer (id, group_id, key, label, basic, auth) VALUES
                                                              (7, 3, 'facility1', '시설물 1',         false, 0),
                                                              (8, 3, 'facility2', '시설물 2',         false, 0),
                                                              (9, 3, 'facility3', '시설물 3',         false, 0);

