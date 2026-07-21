-- ============================================================
-- OSM 임포트 메뉴 추가 마이그레이션
-- 1. "네트워크" 탑레벨 탭을 "데이터"로 이름 변경
-- 2. "데이터" 탭 아래에 "OSM 가져오기" 서브메뉴 추가
--
-- 실행 전: 기존 "네트워크" 메뉴의 menuId를 확인하세요
--   SELECT menu_id, name_kor, depth, menu_code FROM menu WHERE depth = 0;
-- ============================================================

-- ── 1. "네트워크" → "데이터" 이름 변경 ───────────────────────────────────
UPDATE menu
SET name_kor = '데이터',
    name_en  = 'Data',
    menu_code = 'DATA'
WHERE depth = 0
  AND name_kor = '네트워크'
  AND available = 'Y';

-- ── 2. "데이터" 메뉴의 menuId 조회 (아래 INSERT에 사용) ──────────────────
-- SELECT menu_id FROM menu WHERE menu_code = 'DATA' AND depth = 0;
-- 조회 결과를 :data_menu_id 자리에 직접 넣어주세요.

-- ── 3. "OSM 가져오기" 서브메뉴 추가 ─────────────────────────────────────
-- parents_id, root_id = 위에서 조회한 "데이터" 메뉴의 menu_id
-- sort_order는 기존 마지막 순서 + 1로 조정하세요.

INSERT INTO menu (menu_code, language, name_kor, name_en, parents_id, root_id, depth, sort_order, available, access_role)
SELECT
    'OSM_IMPORT',
    'KOR',
    'OSM 가져오기',
    'Import from OSM',
    m.menu_id,   -- parents_id = "데이터" 메뉴
    m.menu_id,   -- root_id    = "데이터" 메뉴
    1,           -- depth = 1 (서브메뉴)
    COALESCE(
        (SELECT MAX(sort_order) + 1 FROM menu WHERE parents_id = m.menu_id),
        1
    ),
    'Y',
    'ROLE_ADMIN'
FROM menu m
WHERE m.menu_code = 'DATA'
  AND m.depth = 0
  AND m.available = 'Y';

-- ── 확인 쿼리 ────────────────────────────────────────────────────────────
-- SELECT menu_id, menu_code, name_kor, depth, sort_order, available
-- FROM menu
-- WHERE menu_code IN ('DATA', 'OSM_IMPORT')
-- ORDER BY depth, sort_order;
