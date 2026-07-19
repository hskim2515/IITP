import type { SignalTilePayload } from "@managers/SignalTileManager";

/**
 * 신호 타일 멤버십 헬퍼 — viewport 신호(nodeId → signal)를 refcount 로 관리.
 *
 * <p>신호 노드가 타일 격자 경계에 걸치면 같은 nodeId 가 인접 타일에 함께 등장할 수 있다.
 * 단순 Map 삭제는 한 타일 evict 시 다른 타일이 보유 중인 노드까지 지워버린다(경계 버그).
 * nodeId 별 refcount 로 마지막 타일 evict 에서만 제거한다 (네트워크 타일과 동일 원리).
 *
 * <p>OL(SignalFeatureLayer)·Cesium(SignalDataSourceLayer) 가 동일 로직을 공유한다.
 */
export class SignalTileMembership {
    /** nodeId → signal 데이터 (현재 viewport 보유분) */
    readonly signals = new Map<string, any>();
    /** nodeId → 보유 타일 수 */
    private refCount = new Map<string, number>();

    /** 타일 로드 시: 신호 추가 + refcount 증가. 변경이 있으면 true */
    add(payload: SignalTilePayload): boolean {
        let changed = false;
        for (const s of payload.signals) {
            const id = String(s.nodeId);
            const rc = (this.refCount.get(id) ?? 0) + 1;
            this.refCount.set(id, rc);
            if (rc === 1) { this.signals.set(id, s); changed = true; }
        }
        return changed;
    }

    /** 타일 evict 시: refcount 감소, 마지막(1→0)에서만 신호 제거. 변경이 있으면 true */
    remove(payload: SignalTilePayload): boolean {
        let changed = false;
        for (const s of payload.signals) {
            const id = String(s.nodeId);
            const rc = (this.refCount.get(id) ?? 0) - 1;
            if (rc <= 0) {
                this.refCount.delete(id);
                if (this.signals.delete(id)) changed = true;
            } else {
                this.refCount.set(id, rc);
            }
        }
        return changed;
    }

    /** 현재 보유 신호 목록 */
    values(): any[] {
        return [...this.signals.values()];
    }

    clear(): void {
        this.signals.clear();
        this.refCount.clear();
    }
}
