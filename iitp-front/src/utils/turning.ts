/**
 * 커넥션 turning 값 정규화.
 *
 * <p>백엔드 Turning enum(DbMappedEnum, {@code @JsonValue})은 짧은 코드로 직렬화된다
 * ("S"/"L"/"R" — Turning.java 참고). 반면 프론트 에디터가 새로 만드는 커넥션은
 * TurningType 전체 단어("Straight"/"Left_Turn"/"Right_Turn"/"U_Turn")를 쓴다.
 * 두 형식이 같은 conn.turning 필드에 혼재하는데, 렌더/색상/아이콘 분기 다수가
 * 전체 단어 리터럴만 비교해 실제 KTDB 데이터(짧은 코드)에서는 항상 매치에
 * 실패했다 — "직진 커넥션이 전부 곡선으로 그려짐" 실사용 발견의 원인.
 *
 * <p>turning 값을 비교/조회하는 곳은 항상 이 함수로 정규화할 것.
 */
export type TurningWord = 'Straight' | 'Left_Turn' | 'Right_Turn' | 'U_Turn';

export function normalizeTurning(t: unknown): TurningWord {
    switch (t) {
        case 'S': case 'Straight': return 'Straight';
        case 'L': case 'Left_Turn': case 'Left': return 'Left_Turn';
        case 'R': case 'Right_Turn': case 'Right': return 'Right_Turn';
        case 'U': case 'U_Turn': return 'U_Turn';
        default: return 'Straight'; // 미상 값은 직진 취급 (기존 기본값과 동일)
    }
}
