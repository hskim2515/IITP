import type { BusStationTilePayload } from "@managers/BusStationTileManager";

/**
 * 버스정류장 타일 멤버십 헬퍼 — viewport 정류장(id → station)을 refcount 로 관리.
 *
 * <p>정류장이 타일 격자 경계에 걸치면 같은 id 가 인접 타일에 함께 등장할 수 있다.
 * 단순 Map 삭제는 한 타일 evict 시 다른 타일이 보유 중인 정류장까지 지워버린다(경계 버그).
 * id 별 refcount 로 마지막 타일 evict 에서만 제거한다(네트워크/신호 타일과 동일 원리).
 * 신호(signalTileMembership)와 달리 nodeId가 아니라 정류장 고유 id로 dedupe한다 — 한
 * linkRef(도로)에 여러 정류장이 있을 수 있어 linkRef 단위로는 다른 정류장이 밀릴 수 있다.
 */
export class BusStationTileMembership {
    /** id → 정류장 데이터 (현재 viewport 보유분) */
    readonly stations = new Map<string, any>();
    /** id → 보유 타일 수 */
    private refCount = new Map<string, number>();

    /** 타일 로드 시: 정류장 추가 + refcount 증가. 변경이 있으면 true */
    add(payload: BusStationTilePayload): boolean {
        let changed = false;
        for (const s of payload.busStations) {
            const id = String(s.id);
            const rc = (this.refCount.get(id) ?? 0) + 1;
            this.refCount.set(id, rc);
            if (rc === 1) { this.stations.set(id, s); changed = true; }
        }
        return changed;
    }

    /** 타일 evict 시: refcount 감소, 마지막(1→0)에서만 정류장 제거. 변경이 있으면 true */
    remove(payload: BusStationTilePayload): boolean {
        let changed = false;
        for (const s of payload.busStations) {
            const id = String(s.id);
            const rc = (this.refCount.get(id) ?? 0) - 1;
            if (rc <= 0) {
                this.refCount.delete(id);
                if (this.stations.delete(id)) changed = true;
            } else {
                this.refCount.set(id, rc);
            }
        }
        return changed;
    }

    /** 현재 보유 정류장 목록 */
    values(): any[] {
        return [...this.stations.values()];
    }

    clear(): void {
        this.stations.clear();
        this.refCount.clear();
    }
}
