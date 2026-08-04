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
                       form_type TEXT DEFAULT 'checkbox',
                       url TEXT DEFAULT '',
                       auth INTEGER DEFAULT 0
);

-- layer_group 삽입
INSERT INTO layer_group (key, label) VALUES
                                         ('baseMap', '배경지도'),
                                         ('analyze', '분석'),
                                         ('facility', '시설물');

-- baseMap 그룹
INSERT INTO layer (id, group_id, key, label, basic, auth, form_type, url) VALUES
                                                              (1, 1, 'osm',       'OSM 지도',            false, 0, 'radio', 'https://a.tile.thunderforest.com/transport-dark/{z}/{x}/{y}.png'),
                                                              (2, 1, 'base',      'VWorld 일반지도',     false,  0, 'radio', 'http://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/Base/{z}/{y}/{x}.png'),
                                                              (3, 1, 'satellite', 'VWorld 위성지도',     false, 0, 'radio', 'http://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/Satellite/{z}/{y}/{x}.jpeg'),
                                                              (4, 1, 'hybrid',    'VWorld Hybrid지도',   false, 0, 'radio', 'http://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/Hybrid/{z}/{y}/{x}.png'),
                                                              (11, 1, 'midnight',    'VWorld 야간지도',   true, 0, 'radio', 'http://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/midnight/{z}/{y}/{x}.png'),
                                                              (32, 1, 'white',       'VWorld 백지도',     false, 0, 'radio', 'http://api.vworld.kr/req/wmts/1.0.0/${API_KEY}/white/{z}/{y}/{x}.png');

-- layer 그룹
INSERT INTO layer (id, group_id, key, label, basic, auth) VALUES
                                                              (5, 2, 'heatmap', '히트맵 분석',        false, 0),
                                                              (6, 2, 'trip',    '트립플로우 분석',    false, 0),
                                                              (23, 2, 'speed',   '속도 히트맵',    false, 0),
                                                              (24, 2, 'traffic', '교통량 히트맵', false, 0),
                                                              (10, 2, 'od',    'OD 분석',    false, 0),
                                                              (21, 2, 'vehicle',    '차량 분석 결과',    true, 0);

-- facility 그룹
INSERT INTO layer (id, group_id, key, label, basic, auth) VALUES
                                                              (7, 3, 'network', '도로',         true, 0),
                                                              (8, 3, 'signal', '신호등',         false, 0),
                                                              (9, 3, 'busStation', '버스 정류장',         false, 0),
                                                              (12, 3, 'drtStation', 'DRT 정류장',         false, 0),
                                                              (13, 3, 'railStation', 'RAIL 정류장',         false, 0),
                                                              (14, 3, 'tramStation', 'TRAM 정류장',         false, 0),
                                                              (15, 3, 'busGarage', '버스 차고지',         false, 0),
                                                              (16, 3, 'tramGarage', '트램 차고지',         false, 0),
                                                              (17, 3, 'roadMarkings', '노면표시',         false, 0),
                                                              (18, 3, 'busRoute', '버스 노선',         false, 0),
                                                              (19, 3, 'railRoute', 'RAIL 노선',         false, 0),
                                                              (20, 3, 'tramRoute', 'TRAM 노선',         false, 0),
                                                              (22, 3, 'pavementMarking', '노면표시',         false, 0);

-- 링크 혼잡도(V/C)/서비스수준(LOS)/병목 링크 분석 레이어 (analyze 그룹 추가)
INSERT INTO layer (id, group_id, key, label, basic, auth, form_type, url) VALUES
                                                              (25, 2, 'congestion', '혼잡도 히트맵',      false, 0, 'checkbox', ''),
                                                              (26, 2, 'los',        '서비스수준(LOS)',    false, 0, 'checkbox', ''),
                                                              (27, 2, 'bottleneck', '병목 링크',          false, 0, 'checkbox', '');

-- 행정구역(시도/시군구/읍면동) 기반 교통량 레이어 (analyze 그룹 추가)
INSERT INTO layer (id, group_id, key, label, basic, auth, form_type, url) VALUES
                                                              (28, 2, 'region', '지역별 교통량(행정구역)', false, 0, 'checkbox', '');

-- 지식그래프 스타일 분석 레이어 2종 (analyze 그룹 추가)
INSERT INTO layer (id, group_id, key, label, basic, auth, form_type, url) VALUES
                                                              (29, 2, 'regionOdGraph', '지역 OD 관계 그래프', false, 0, 'checkbox', ''),
                                                              (30, 2, 'congestionGraph', '혼잡 전파 그래프', false, 0, 'checkbox', '');

-- 등시선(isochrone) 접근성 지도 레이어 (analyze 그룹 추가)
INSERT INTO layer (id, group_id, key, label, basic, auth, form_type, url) VALUES
                                                              (31, 2, 'isochrone', '시설 서비스권 분석', false, 0, 'checkbox', '');

