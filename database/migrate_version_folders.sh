#!/usr/bin/env bash
# ============================================================================
# 버전별 격리 마이그레이션 (파일): scenario.key 폴더 → 기본 version.key 폴더 복사
# ============================================================================
# 배경: 데이터 식별자를 version.key 로 통일하면서, 기존 데이터가 있는
#   {scenario.key}/ 폴더(network.xml, vehicle_sim.db 등)를 기본 버전 폴더
#   {version.key}/ 로 복사해 작업물을 유지한다. migration_version_id.sql(DB)과 짝.
#
# 매핑: 각 scenario 의 첫 버전을 기본 버전으로 (scenario1 → scenario1_1 ...)
#   DB(scenario_version)에서 조회하지 않고, 아래 MAP 배열로 명시(단순·검토 용이).
#
# 안전:
#   - 대상 폴더에 이미 network.xml 이 있으면 덮어쓰지 않음(-n). 신규 파일만 채움.
#   - 원본({scenario.key}/)은 그대로 둔다(롤백/폴백 대비).
#   - DRY_RUN=1 이면 실제 복사 없이 계획만 출력.
#
# 사용:
#   BASE=~/.iitp-local/models DRY_RUN=1 bash database/migrate_version_folders.sh   # 미리보기
#   BASE=~/.iitp-local/models bash database/migrate_version_folders.sh             # 실행
#   (배포 SFTP 는 서버에서 BASE=/home/gaia3d/iitp/data/models 로 별도 수행)
# ============================================================================
set -euo pipefail

BASE="${BASE:-$HOME/.iitp-local/models}"
DRY_RUN="${DRY_RUN:-0}"

# scenario.key : 기본 version.key
MAP=(
  "scenario1:scenario1_1"
  "scenario2:scenario2_1"
  "scenario3:scenario3_1"
)

echo "[migrate] BASE=$BASE  DRY_RUN=$DRY_RUN"
[ -d "$BASE" ] || { echo "[migrate] BASE 디렉토리 없음: $BASE"; exit 1; }

for pair in "${MAP[@]}"; do
  src_key="${pair%%:*}"
  dst_key="${pair##*:}"
  src="$BASE/$src_key"
  dst="$BASE/$dst_key"

  if [ ! -d "$src" ]; then
    echo "[skip] 원본 없음: $src"
    continue
  fi

  echo "[copy] $src_key/  →  $dst_key/"
  if [ "$DRY_RUN" = "1" ]; then
    # 복사될 파일 미리보기 (대상에 없는 것만)
    (cd "$src" && find . -type f) | while read -r f; do
      if [ ! -e "$dst/$f" ]; then echo "    + $f"; else echo "    = $f (이미 있음, 유지)"; fi
    done
    continue
  fi

  mkdir -p "$dst"
  # -n: 대상에 이미 있으면 덮어쓰지 않음 (신규 파일만 채움)
  # 큰 파일(vehicle_sim.db 2.4GB, network.xml 106MB) 포함 → cp -n 로 안전 복사
  (cd "$src" && find . -type d -exec mkdir -p "$dst/{}" \;)
  (cd "$src" && find . -type f) | while read -r f; do
    if [ ! -e "$dst/$f" ]; then
      cp -p "$src/$f" "$dst/$f"
      echo "    + $f"
    else
      echo "    = $f (유지)"
    fi
  done
done

echo "[migrate] 완료. 원본(scenario.key) 폴더는 보존됨."
