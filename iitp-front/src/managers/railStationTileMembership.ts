import type { RailStationTilePayload } from "@managers/RailStationTileManager";

/**
 * 철도정류장 타일 멤버십 헬퍼 — viewport 정류장(id → station)을 refcount 로 관리.
 * busStationTileMembership과 동일 원리(경계 걸침 시 refcount로만 제거).
 */
export class RailStationTileMembership {
    readonly stations = new Map<string, any>();
    private refCount = new Map<string, number>();

    add(payload: RailStationTilePayload): boolean {
        let changed = false;
        for (const s of payload.railStations) {
            const id = String(s.id);
            const rc = (this.refCount.get(id) ?? 0) + 1;
            this.refCount.set(id, rc);
            if (rc === 1) { this.stations.set(id, s); changed = true; }
        }
        return changed;
    }

    remove(payload: RailStationTilePayload): boolean {
        let changed = false;
        for (const s of payload.railStations) {
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

    values(): any[] {
        return [...this.stations.values()];
    }

    clear(): void {
        this.stations.clear();
        this.refCount.clear();
    }
}
