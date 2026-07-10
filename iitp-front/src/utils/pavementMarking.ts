/**
 * 네트워크의 intersection 노드 connection 정보를 기반으로
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
        if (node.type?.toLowerCase() !== 'intersection') continue;
        const conns = node.connections ?? [];
        if (conns.length === 0) continue;

        // (fromLink, fromLane) 기준 회전 방향 집계
        const laneTurnings = new Map<string, Set<string>>();
        for (const conn of conns) {
            const key = `${conn.fromLink}_${conn.fromLane}`;
            if (!laneTurnings.has(key)) laneTurnings.set(key, new Set());
            laneTurnings.get(key)!.add(conn.turning ?? 'S');
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

            const hasS = turnings.has('S');
            const hasL = turnings.has('L');
            const hasR = turnings.has('R');
            const hasU = turnings.has('U');

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
