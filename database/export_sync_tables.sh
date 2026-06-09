#!/bin/bash
# 로컬 DB 현재 상태 → sync_tables.sql 자동 생성
# 사용: ./database/export_sync_tables.sh
# 이후 sync_tables.sql을 커밋하면 다음 배포 때 서버에 반영됨

set -e

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
PGPASSWORD="${PGPASSWORD:-postgres}"
PGDATABASE="${PGDATABASE:-iitp}"
export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE

PSQL="psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -v ON_ERROR_STOP=1"
OUT="$(cd "$(dirname "$0")" && pwd)/sync_tables.sql"

echo "DB: $PGDATABASE@$PGHOST:$PGPORT 에서 내보내는 중..."

$PSQL -c "SELECT 1" > /dev/null 2>&1 || {
  echo "오류: DB에 연결할 수 없습니다. 환경변수(PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE)를 확인하세요."
  exit 1
}

cat > "$OUT" << HEADER
-- ============================================================
-- CI/CD 동기화 스크립트: menu, layer_schema_config, layer_schema_config_option
-- 생성: $(date '+%Y-%m-%d %H:%M:%S') (export_sync_tables.sh)
-- ============================================================

BEGIN;

HEADER

# ── menu ────────────────────────────────────────────────────────
echo "  menu 테이블 내보내는 중..."

cat >> "$OUT" << 'SQL'
-- ── menu ────────────────────────────────────────────────────────
TRUNCATE TABLE menu RESTART IDENTITY CASCADE;

SQL

$PSQL --no-align --tuples-only << 'QUERY' >> "$OUT"
SELECT
  'INSERT INTO public.menu (menu_id, menu_code, available, access_role, depth, language, name_en, name_kor, sort_order, parents_id, root_id, created_by, created_date, last_modified_by, last_modified_date) VALUES (' ||
  menu_id || ', ' ||
  quote_literal(menu_code) || ', ' ||
  COALESCE(quote_literal(trim(available)), 'NULL') || ', ' ||
  COALESCE(quote_literal(access_role), 'NULL') || ', ' ||
  depth || ', ' ||
  COALESCE(quote_literal(language), 'NULL') || ', ' ||
  COALESCE(quote_literal(name_en), 'NULL') || ', ' ||
  COALESCE(quote_literal(name_kor), 'NULL') || ', ' ||
  sort_order || ', ' ||
  COALESCE(parents_id::text, 'NULL') || ', ' ||
  COALESCE(root_id::text, 'NULL') || ', ' ||
  quote_literal(created_by) || ', ' ||
  quote_literal(created_date) || ', ' ||
  quote_literal(last_modified_by) || ', ' ||
  quote_literal(last_modified_date) || ');'
FROM menu
ORDER BY menu_id;
QUERY

cat >> "$OUT" << 'SQL'

SELECT setval(pg_get_serial_sequence('menu', 'menu_id'), MAX(menu_id)) FROM menu;

SQL

# ── layer_schema_config ──────────────────────────────────────────
echo "  layer_schema_config 테이블 내보내는 중..."

cat >> "$OUT" << 'SQL'
-- ── layer_schema_config ──────────────────────────────────────────
TRUNCATE TABLE layer_schema_config_option, layer_schema_config RESTART IDENTITY CASCADE;

SQL

$PSQL --no-align --tuples-only << 'QUERY' >> "$OUT"
SELECT
  'INSERT INTO public.layer_schema_config (id, config_key, input_type, sort_order) VALUES (' ||
  id || ', ' ||
  quote_literal(config_key) || ', ' ||
  quote_literal(input_type) || ', ' ||
  sort_order || ');'
FROM layer_schema_config
ORDER BY id;
QUERY

cat >> "$OUT" << 'SQL'

SELECT setval(pg_get_serial_sequence('layer_schema_config', 'id'), MAX(id)) FROM layer_schema_config;

SQL

# ── layer_schema_config_option ───────────────────────────────────
echo "  layer_schema_config_option 테이블 내보내는 중..."

cat >> "$OUT" << 'SQL'
-- ── layer_schema_config_option ───────────────────────────────────
SQL

$PSQL --no-align --tuples-only << 'QUERY' >> "$OUT"
SELECT
  'INSERT INTO public.layer_schema_config_option (id, value, definition_id) VALUES (' ||
  id || ', ' ||
  COALESCE(quote_literal(value), 'NULL') || ', ' ||
  COALESCE(definition_id::text, 'NULL') || ');'
FROM layer_schema_config_option
ORDER BY id;
QUERY

cat >> "$OUT" << 'SQL'

SELECT setval(pg_get_serial_sequence('layer_schema_config_option', 'id'), MAX(id)) FROM layer_schema_config_option;

COMMIT;
SQL

echo "완료: $OUT"
echo "확인 후 커밋하세요: git add database/sync_tables.sql"
