import { normalizeTurning } from '@utils/turning';

/**
 * 네트워크의 교차로(진입/진출 포트가 모두 있는) 노드 connection 정보를 기반으로
 * 각 진입 차선의 회전 방향에 맞는 노면 표시 더미 데이터를 생성한다.
 *
 * 생성된 데이터의 coordinates/angle은 렌더링 시 interpolateByOffset이
 * 실제 레인 지오메트리에서 계산해 덮어쓰므로 null로 둔다.
 */
export const generateDummyPavementMarkings = (network: any): any[] => {
    const markings: any[] = [];

    const linkMap = new Map<string, any>();
    for (const link of network?.links ?? []) {
        linkMap.set(String(link.id), link);
    }

    let idCounter = 0;

    for (const node of network?.nodes ?? []) {
        // node.type === 'intersection'은 KTDB/SUMO 임포트 컨버터만 붙이는 값이라, 직접 그리기
        // 도구로 만든 노드는 실제로 교차로가 돼도 영원히 'normal'로 남는다(백엔드 저장 시
        // NetworkIdNormalizer도 Terminal/Normal로만 재분류, Intersection으로는 안 바꿈).
        // 그 결과 직접 그린/편집한 교차로는 노면표시가 하나도 안 생기는 버그가 있었다.
        // 대신 useNetworkDraw.ts의 autoGenerateAllIntersections와 동일한 포트 기반 판정 사용
        // (진입/진출 포트가 모두 있으면 실제 교차로).
        const inCount = node.ports?.filter((p: any) => p.type === 'in').length ?? 0;
        const outCount = node.ports?.filter((p: any) => p.type === 'out').length ?? 0;
        if (inCount < 1 || outCount < 1) continue;
        const conns = node.connections ?? [];
        if (conns.length === 0) continue;

        // (fromLink, fromLane) 기준 회전 방향 집계
        // conn.turning은 KTDB 임포트(짧은 코드 "S"/"L"/"R"/"U")와 직접 그리기 도구(전체 단어
        // "Straight"/"Left_Turn"/...)가 같은 필드에 서로 다른 형식으로 섞여 들어온다 — 정규화
        // 없이 짧은 코드만 비교하면 직접 만들거나 수정한 커넥션은 항상 매칭 실패로
        // markingType이 무조건 'Straight'가 되는 버그가 있었다(커넥션 렌더링에서 이미 한 번
        // 겪고 normalizeTurning()으로 고친 것과 동일한 유형).
        const laneTurnings = new Map<string, Set<string>>();
        for (const conn of conns) {
            const key = `${conn.fromLink}_${conn.fromLane}`;
            if (!laneTurnings.has(key)) laneTurnings.set(key, new Set());
            laneTurnings.get(key)!.add(normalizeTurning(conn.turning));
        }

        for (const [key, turnings] of laneTurnings.entries()) {
            const underIdx = key.indexOf('_');
            const linkIdStr = key.slice(0, underIdx);
            const laneIdxStr = key.slice(underIdx + 1);

            const link = linkMap.get(linkIdStr);
            if (!link) continue;

            const laneIdx = Number(laneIdxStr);
            const lane = link.lanes?.[laneIdx];
            if (!lane) continue;

            const cells: any[] = lane.cells ?? [];
            if (cells.length === 0) continue;

            // 마지막 셀(교차로 직전) 중앙에 마킹 배치
            const lastCellIdx = cells.length - 1;
            const cellOffset = Number(cells[lastCellIdx]?.length ?? 0) / 2;

            const hasS = turnings.has('Straight');
            const hasL = turnings.has('Left_Turn');
            const hasR = turnings.has('Right_Turn');
            const hasU = turnings.has('U_Turn');

            let markingType: string;
            if (hasU)                   markingType = 'UTurn';
            else if (hasS && hasL && hasR) markingType = 'Diamond';
            else if (hasS && hasL)      markingType = 'StraightLeft';
            else if (hasS && hasR)      markingType = 'StraightRight';
            else if (hasL && hasR)      markingType = 'Diamond';
            else if (hasS)              markingType = 'Straight';
            else if (hasL)              markingType = 'LeftTurn';
            else if (hasR)              markingType = 'RightTurn';
            else                        markingType = 'Straight';

            markings.push({
                id: String(idCounter++),
                linkRef: Number(link.id),
                laneRef: laneIdx,
                cellId: lastCellIdx,
                offset: cellOffset,
                markingType,
                angle: null,
                coordinates: [{ lng: null, lat: null }],
            });
        }
    }

    return markings;
};
