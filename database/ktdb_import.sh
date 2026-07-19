#!/bin/bash
# KTDB 표준노드링크 SHP → PostgreSQL import (ogr2ogr만 사용, Python 불필요)
# 실행: bash database/ktdb_import.sh

set -e

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-iitp}"
DB_USER="${DB_USER:-postgres}"
DB_PASS="${DB_PASS:-postgres}"
KTDB_DIR="${KTDB_DIR:-/Users/hskim/Documents/data/ktdb}"

export PGPASSWORD=$DB_PASS
PG_CONN="PG:host=$DB_HOST port=$DB_PORT dbname=$DB_NAME user=$DB_USER password=$DB_PASS"

echo "=== KTDB 표준노드링크 PostgreSQL import ==="
echo "DB: $DB_HOST:$DB_PORT/$DB_NAME"
echo "SHP: $KTDB_DIR"

# ── 1. 임시 테이블로 ogr2ogr import (좌표계 5186 → 4326 변환) ─────────────────
echo "[1/4] NODE SHP import 중..."
ogr2ogr -f "PostgreSQL" "$PG_CONN" \
  -nln ktdb_node_raw \
  -nlt POINT \
  -t_srs EPSG:4326 \
  -overwrite \
  -lco GEOMETRY_NAME=geom \
  -lco FID=fid \
  "$KTDB_DIR/MOCT_NODE.shp"

echo "[2/4] LINK SHP import 중 (시간이 걸립니다)..."
ogr2ogr -f "PostgreSQL" "$PG_CONN" \
  -nln ktdb_link_raw \
  -nlt LINESTRING \
  -t_srs EPSG:4326 \
  -overwrite \
  -lco GEOMETRY_NAME=geom \
  -lco FID=fid \
  "$KTDB_DIR/MOCT_LINK.shp"

# TURNINFO/MULTILINK: 지오메트리 없는 DBF 속성 테이블
# (.cpg 파일이 없어 한글 REMARK/ROAD_NAME이 CP949로 읽힘 → SHAPE_ENCODING 명시)
echo "[2b/4] TURNINFO/MULTILINK import 중..."
if [ -f "$KTDB_DIR/TURNINFO.dbf" ]; then
  ogr2ogr -f "PostgreSQL" "$PG_CONN" --config SHAPE_ENCODING CP949 \
    -nln ktdb_turninfo_raw -overwrite -lco FID=fid "$KTDB_DIR/TURNINFO.dbf"
fi
if [ -f "$KTDB_DIR/MULTILINK.dbf" ]; then
  ogr2ogr -f "PostgreSQL" "$PG_CONN" --config SHAPE_ENCODING CP949 \
    -nln ktdb_multilink_raw -overwrite -lco FID=fid "$KTDB_DIR/MULTILINK.dbf"
fi

# ── 2. 정제 테이블 생성 ───────────────────────────────────────────────────────
echo "[3/4] 정제 테이블 생성 중..."
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME <<'SQL'

-- NODE 정제 (node_type: 101=평면교차로 등, node_name: 교차로명, turn_p: 회전제한 존재)
DROP TABLE IF EXISTS ktdb_node;
CREATE TABLE ktdb_node AS
SELECT
    node_id::VARCHAR(20)                  AS node_id,
    ST_X(geom)::DOUBLE PRECISION          AS lon,
    ST_Y(geom)::DOUBLE PRECISION          AS lat,
    COALESCE(node_type, '')::VARCHAR(3)   AS node_type,
    COALESCE(node_name, '')::VARCHAR(50)  AS node_name,
    COALESCE(turn_p, '0')::VARCHAR(1)     AS turn_p
FROM ktdb_node_raw
WHERE node_id IS NOT NULL;

ALTER TABLE ktdb_node ADD PRIMARY KEY (node_id);
CREATE INDEX idx_ktdb_node_lat_lon ON ktdb_node (lat, lon);
DROP TABLE ktdb_node_raw;

-- LINK 정제 (coords는 JSON 배열로 변환)
DROP TABLE IF EXISTS ktdb_link;
CREATE TABLE ktdb_link AS
SELECT
    link_id::VARCHAR(20)                               AS link_id,
    f_node::VARCHAR(20)                                AS f_node,
    t_node::VARCHAR(20)                                AS t_node,
    COALESCE(lanes, 1)::INTEGER                        AS lanes,
    COALESCE(road_rank::INTEGER, 106)                  AS road_rank,
    COALESCE(road_name, '')::VARCHAR(100)              AS road_name,
    COALESCE(max_spd, 50)::INTEGER                     AS max_spd,
    COALESCE(length, 0)::DOUBLE PRECISION              AS length,
    -- 구조물/운영 속성 (000 일반, 001 고가차도, 002 지하차도, 003 교량, 004 터널)
    COALESCE(road_type, '000')::VARCHAR(3)             AS road_type,
    COALESCE(road_no, '')::VARCHAR(5)                  AS road_no,
    COALESCE(connect, '0')::VARCHAR(3)                 AS connect,
    COALESCE(road_use, '0')::VARCHAR(1)                AS road_use,
    COALESCE(multi_link, '0')::VARCHAR(1)              AS multi_link,
    COALESCE(rest_veh, '0')::VARCHAR(3)                AS rest_veh,
    COALESCE(rest_w, 0)::INTEGER                       AS rest_w,
    COALESCE(rest_h, 0)::INTEGER                       AS rest_h,
    ST_X(ST_LineInterpolatePoint(geom, 0.5))           AS mid_lon,
    ST_Y(ST_LineInterpolatePoint(geom, 0.5))           AS mid_lat,
    -- coords: [{"lng":..,"lat":..}, ...] JSON 배열
    (
        SELECT jsonb_agg(jsonb_build_object(
            'lng', ST_X(pt)::NUMERIC(10,7),
            'lat', ST_Y(pt)::NUMERIC(10,7)
        ))
        FROM generate_series(1, ST_NPoints(geom)) AS i,
             ST_PointN(geom, i) AS pt
    )::JSONB AS coords
FROM ktdb_link_raw
WHERE link_id IS NOT NULL
  AND f_node  IS NOT NULL
  AND t_node  IS NOT NULL;

ALTER TABLE ktdb_link ADD PRIMARY KEY (link_id);
CREATE INDEX idx_ktdb_link_bbox   ON ktdb_link (mid_lon, mid_lat);
CREATE INDEX idx_ktdb_link_f_node ON ktdb_link (f_node);
CREATE INDEX idx_ktdb_link_t_node ON ktdb_link (t_node);

DROP TABLE ktdb_link_raw;

-- TURNINFO 정제 (회전정보: 011 좌회전, 012 우회전, 013 U턴, 101 P턴, 001 비보호, 102 유도선, 103 불가침범 / turn_oper 1=금지)
DROP TABLE IF EXISTS ktdb_turninfo;
CREATE TABLE ktdb_turninfo AS
SELECT DISTINCT ON (node_id, st_link, ed_link)
    node_id::VARCHAR(20)                AS node_id,
    st_link::VARCHAR(20)                AS st_link,
    ed_link::VARCHAR(20)                AS ed_link,
    COALESCE(turn_type, '')::VARCHAR(10) AS turn_type,
    COALESCE(turn_oper, '0')::VARCHAR(1) AS turn_oper
FROM ktdb_turninfo_raw
WHERE node_id IS NOT NULL AND st_link IS NOT NULL AND ed_link IS NOT NULL;

ALTER TABLE ktdb_turninfo ADD PRIMARY KEY (node_id, st_link, ed_link);
CREATE INDEX idx_ktdb_turninfo_node ON ktdb_turninfo (node_id);
DROP TABLE IF EXISTS ktdb_turninfo_raw;

-- MULTILINK 정제 (중용구간 노선정보 — 참조용)
DROP TABLE IF EXISTS ktdb_multilink;
CREATE TABLE ktdb_multilink AS
SELECT
    link_id::VARCHAR(20)                 AS link_id,
    multi_id::INTEGER                    AS multi_id,
    COALESCE(road_rank, '')::VARCHAR(3)  AS road_rank,
    COALESCE(road_type, '')::VARCHAR(3)  AS road_type,
    COALESCE(road_no, '')::VARCHAR(5)    AS road_no,
    COALESCE(road_name, '')::VARCHAR(30) AS road_name
FROM ktdb_multilink_raw
WHERE link_id IS NOT NULL;

CREATE INDEX idx_ktdb_multilink_link ON ktdb_multilink (link_id);
DROP TABLE IF EXISTS ktdb_multilink_raw;

SQL

# ── 3. 결과 확인 ──────────────────────────────────────────────────────────────
echo "[4/4] import 완료"
psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME \
  -c "SELECT 'ktdb_node' AS tbl, count(*) FROM ktdb_node
      UNION ALL
      SELECT 'ktdb_link', count(*) FROM ktdb_link
      UNION ALL
      SELECT 'ktdb_turninfo', count(*) FROM ktdb_turninfo
      UNION ALL
      SELECT 'ktdb_multilink', count(*) FROM ktdb_multilink;"
