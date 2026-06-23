import type { NetworkTilePayload } from "@managers/NetworkTileManager";

/**
 * 타일 페이로드에 안정적 합성 __guid/featureType 부여 (읽기 전용 타일 모드 전용).
 *
 * <p>서버 타일 응답에는 __guid 가 없다. 정식 경로는 `assignPropertyToResponseData`(배열 경로 기반)지만,
 * 타일은 배열 인덱스가 타일마다 달라 경로 기반 guid 가 불안정하다. 여기서는 **데이터 id 기반**으로
 * 부여하여 크로스타일·재로드 간 일관성을 보장한다.
 *
 * <p>편집/저장은 전체-로드(ENABLED=false) 경로 전제이므로, 이 합성 guid 가 정식 경로 guid 와
 * 달라도 충돌하지 않는다 (타일 모드는 뷰 전용).
 */
export function assignTileGuids(payload: NetworkTilePayload): void {
    for (const link of payload.links) {
        const lid = String(link.id);
        link.__guid = `T_L${lid}`;
        link.featureType = "links";
        const lanes = link.lanes ?? [];
        for (let i = 0; i < lanes.length; i++) {
            const lane = lanes[i];
            if (!lane) continue;
            lane.__guid = `T_L${lid}_lane${i}`;
            lane.featureType = "lanes";
            const cells = lane.cells ?? [];
            for (let j = 0; j < cells.length; j++) {
                if (cells[j]) { cells[j].__guid = `T_L${lid}_lane${i}_cell${j}`; cells[j].featureType = "cells"; }
            }
            const segs = lane.segments ?? lane.sections ?? [];
            for (let j = 0; j < segs.length; j++) {
                if (segs[j]) { segs[j].__guid = `T_L${lid}_lane${i}_seg${j}`; segs[j].featureType = "segments"; }
            }
        }
    }
    for (const node of payload.nodes) {
        const nid = String(node.id);
        node.__guid = `T_N${nid}`;
        node.featureType = "nodes";
        const ports = node.ports ?? [];
        for (let i = 0; i < ports.length; i++) {
            if (ports[i]) { ports[i].__guid = `T_N${nid}_port${i}`; ports[i].featureType = "ports"; }
        }
        const conns = node.connections ?? [];
        for (let i = 0; i < conns.length; i++) {
            if (conns[i]) { conns[i].__guid = `T_N${nid}_conn${i}`; conns[i].featureType = "connections"; }
        }
    }
}
