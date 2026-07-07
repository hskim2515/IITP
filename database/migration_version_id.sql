-- ============================================================================
-- 버전별 격리 마이그레이션: 데이터 식별자 scenario.key → version.key 통일
-- ============================================================================
-- 배경: 백엔드는 API의 versionId를 그대로 파일 디렉토리·DB version_id 로 사용한다.
--   그런데 프론트가 읽기=scenario.key("scenario1") / 저장=version.key("scenario1_1")로
--   혼재해, 읽기·쓰기가 다른 폴더/레코드를 봐 버전 격리가 깨져 있었다.
--   → 데이터 식별자를 version.key 로 통일. 이 스크립트는 기존 DB 레코드
--     (version_id = scenario.key)를 각 scenario 의 "기본 버전(첫 버전)" version.key 로 이관한다.
--
-- 매핑: 각 scenario 의 첫 버전(id 최소)을 기본 버전으로 삼는다.
--   scenario1 → scenario1_1,  scenario2 → scenario2_1,  scenario3 → scenario3_1
--
-- 안전장치:
--   - version_id 컬럼을 가진 모든 테이블을 information_schema 로 동적 순회 (하드코딩 없음)
--   - 이미 version.key 인 레코드(예: 'scenario1_1')는 건드리지 않음 (scenario.key 만 대상)
--   - 원본(scenario.key) 레코드는 UPDATE 이므로 이동됨. 롤백은 아래 주석 참조.
--   - 트랜잭션으로 감싸 실패 시 전체 롤백.
--
-- 파일(network.xml 등)은 별도 셸 스크립트로 복사: migrate_version_folders.sh
-- ============================================================================

BEGIN;

DO $$
DECLARE
    scen        RECORD;   -- scenario.key → 기본 version.key
    tbl         TEXT;     -- version_id 컬럼 가진 테이블명
    updated_cnt INTEGER;
BEGIN
    -- 각 scenario 의 기본 버전(첫 버전) 매핑을 순회
    FOR scen IN
        SELECT s.key AS scenario_key,
               (SELECT sv.key FROM scenario_version sv
                 WHERE sv.scenario_id = s.id
                 ORDER BY sv.id ASC LIMIT 1) AS default_version_key
        FROM scenario s
    LOOP
        -- 버전이 없는 scenario 는 건너뜀
        IF scen.default_version_key IS NULL THEN
            RAISE NOTICE 'scenario % : 버전 없음 → 건너뜀', scen.scenario_key;
            CONTINUE;
        END IF;

        -- version_id 컬럼을 가진 모든 테이블(스키마 public)을 동적 순회
        FOR tbl IN
            SELECT table_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND column_name  = 'version_id'
            ORDER BY table_name
        LOOP
            EXECUTE format(
                'UPDATE public.%I SET version_id = %L WHERE version_id = %L',
                tbl, scen.default_version_key, scen.scenario_key
            );
            GET DIAGNOSTICS updated_cnt = ROW_COUNT;
            IF updated_cnt > 0 THEN
                RAISE NOTICE '  % : % → %  (% rows)',
                    tbl, scen.scenario_key, scen.default_version_key, updated_cnt;
            END IF;
        END LOOP;
    END LOOP;
END $$;

COMMIT;

-- ============================================================================
-- 롤백 (필요 시): version.key → scenario.key 되돌리기
--   각 version.key 앞부분(scenarioN_M → scenarioN)으로 환원. 단, 여러 버전이 같은
--   scenario 로 합쳐지므로 위 마이그레이션 직후에만 안전하다.
--
-- BEGIN;
-- DO $$
-- DECLARE tbl TEXT;
-- BEGIN
--   FOR tbl IN SELECT table_name FROM information_schema.columns
--              WHERE table_schema='public' AND column_name='version_id'
--   LOOP
--     EXECUTE format(
--       'UPDATE public.%I SET version_id = split_part(version_id, ''_'', 1) '
--       '|| CASE WHEN version_id ~ ''^scenario[0-9]+_'' THEN '''' ELSE '''' END '
--       'WHERE version_id ~ ''^scenario[0-9]+_[0-9]+$''', tbl);
--   END LOOP;
-- END $$;
-- COMMIT;
-- ============================================================================
