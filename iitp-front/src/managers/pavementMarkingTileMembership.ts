import type { PavementMarkingTilePayload } from "@managers/PavementMarkingTileManager";

/**
 * 노면표시 타일 멤버십 헬퍼 — viewport 노면표시(id → marking)를 refcount 로 관리.
 * busStationTileMembership/railStationTileMembership과 동일 원리(경계 걸침 시 refcount로만 제거).
 */
export class PavementMarkingTileMembership {
    readonly markings = new Map<string, any>();
    private refCount = new Map<string, number>();

    add(payload: PavementMarkingTilePayload): boolean {
        let changed = false;
        for (const m of payload.pavementMarkings) {
            const id = String(m.id);
            const rc = (this.refCount.get(id) ?? 0) + 1;
            this.refCount.set(id, rc);
            if (rc === 1) { this.markings.set(id, m); changed = true; }
        }
        return changed;
    }

    remove(payload: PavementMarkingTilePayload): boolean {
        let changed = false;
        for (const m of payload.pavementMarkings) {
            const id = String(m.id);
            const rc = (this.refCount.get(id) ?? 0) - 1;
            if (rc <= 0) {
                this.refCount.delete(id);
                if (this.markings.delete(id)) changed = true;
            } else {
                this.refCount.set(id, rc);
            }
        }
        return changed;
    }

    values(): any[] {
        return [...this.markings.values()];
    }

    clear(): void {
        this.markings.clear();
        this.refCount.clear();
    }
}
