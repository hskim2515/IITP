-- XML 기반 레이어 통합 버전/이력 관리 테이블
-- 대상: network, signal_tod, bus_pt_line, bus_pt_line_weekday, bus_pt_line_weekend,
--       rail_pt_line, simulation_scenario, od_matrix

CREATE TABLE IF NOT EXISTS xml_layer_versions (
    id          BIGSERIAL PRIMARY KEY,
    layer_key   VARCHAR(100)  NOT NULL,  -- e.g. 'signal_tod', 'bus_pt_line'
    version_id  VARCHAR(200)  NOT NULL,  -- scenarioKey 또는 versionId
    data        JSONB,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (layer_key, version_id)
);

CREATE TABLE IF NOT EXISTS xml_layer_logs (
    id          BIGSERIAL PRIMARY KEY,
    layer_key   VARCHAR(100)  NOT NULL,
    version_id  VARCHAR(200)  NOT NULL,
    data        JSONB,                   -- LogsData (added / modified / deleted)
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_xml_layer_versions_key_vid  ON xml_layer_versions (layer_key, version_id);
CREATE INDEX IF NOT EXISTS idx_xml_layer_logs_key_vid_time ON xml_layer_logs      (layer_key, version_id, created_at);
