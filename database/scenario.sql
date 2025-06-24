-- 시퀀스 생성
CREATE SEQUENCE scenario_id_seq START 1;
CREATE SEQUENCE scenario_version_id_seq START 1;

-- scenario 테이블
CREATE TABLE scenario (
                             id INTEGER PRIMARY KEY DEFAULT nextval('scenario_id_seq'),
                             key TEXT UNIQUE NOT NULL,
                             latitude DOUBLE PRECISION NOT NULL,
                             longitude DOUBLE PRECISION NOT NULL,
                             label TEXT,
                             description TEXT
);

-- scenario version 테이블
CREATE TABLE scenario_version (
                       id INTEGER PRIMARY KEY DEFAULT nextval('scenario_version_id_seq'),
                       scenario_id INTEGER NOT NULL REFERENCES scenario(id) ON DELETE CASCADE,
                       key TEXT NOT NULL,
                       label VARCHAR(255) NOT NULL DEFAULT '',
                       insert_date TIMESTAMP NOT NULL DEFAULT Now(),
                       modify_date TIMESTAMP
);

-- scenario 삽입
INSERT INTO scenario (key, longitude, latitude, label, description) VALUES
                                         ('scenario1', 126.7325, 37.4928, '출근 시간대 시뮬레이션', '오전 7시 ~ 9시 혼잡도 분석'),
                                         ('scenario2', 126.9000, 37.4800, '퇴근 시간대 시뮬레이션', '오후 6시 ~ 8시 교차로 체증 분석'),
                                         ('scenario3', 127.0000, 37.5700, '이벤트 발생 시뮬레이션', '도심 내 대형 행사에 따른 우회 경로 분석');

-- scenario version 삽입
INSERT INTO scenario_version (scenario_id, key, label, insert_date) VALUES
                                                              (1, 'scenario1_1', 'version 1',       Now()),
                                                              (1, 'scenario1_2', 'version 2',      Now()),
                                                              (2, 'scenario2_1', 'version 1', Now()),
                                                              (2, 'scenario2_2', 'version 2',    Now()),
                                                              (3, 'scenario3_1', 'version 1',    Now());