import { toLonLat } from "ol/proj";
import type { Extent } from "ol/extent";
import { NETWORK_TILING, networkLodParam, NETWORK_LOD_TIER_ORDER, type NetworkLodTier } from "@utils/lodConstants";
import axiosInstance from "@api/axiosInstance";
import { useNetworkTileStore } from "@stores/useNetworkTileStore";

/** 한 타일의 서버 응답 페이로드 (NetworkResponse 부분집합) */
export interface NetworkTilePayload {
    links: any[];
    nodes: any[];
}

interface TileEntry {
    payload: NetworkTilePayload;
    lastUsed: number;
    /** 이 타일을 받아온 LOD tier 순서 (near=2 < detail=3). detail 요청 시 near 타일은 재요청 필요(차선 stripped) */
    tierOrder: number;
}

export interface NetworkTileManagerCallbacks {
    /** 타일이 새로 로드됨 — 소비자(OL/Cesium)가 피처/프리미티브를 빌드.
     *  tierOrder: 이 타일을 받아온 LOD tier 순서 (near=2, detail=3) — detail에서만 무거운 리소스(엔티티) 빌드용 */
    onTileLoaded: (tileKey: string, payload: NetworkTilePayload, tierOrder: number) => void;
    /** 타일이 evict됨 — 소비자가 해당 타일 피처/프리미티브를 destroy (id 기준 refcount는 소비자 책임) */
    onTileEvicted: (tileKey: string, payload: NetworkTilePayload) => void;
}

/**
 * 네트워크 BBox 타일 매니저 (단계 2, 읽기 전용).
 *
 * <p>viewport(+prefetch ring) 와 겹치는 타일만 서버에서 fetch 하고, 벗어난 타일은 LRU 로 evict 한다.
 * 클라이언트가 메모리에 들고 있는 데이터를 viewport 규모로 제한 → 광역권→전국 대응.
 *
 * <p><b>소비자 비의존</b>: 타일 키 계산·fetch·캐시·evict 만 담당하고, 실제 렌더링(피처/프리미티브 빌드)은
 * 콜백으로 위임한다. 따라서 OL/Cesium 양쪽이 같은 매니저를 공유할 수 있다.
 *
 * <p>tile-key 는 WGS84 경위도 격자(TILE_DEG). 서버 API 는 `?bbox=west,south,east,north&lod=...`.
 */
export class NetworkTileManager {
    /** 현재 메모리에 보유 중인 타일 (LRU) */
    private tiles = new Map<string, TileEntry>();
    /** in-flight fetch (중복 요청 방지) */
    private inFlight = new Map<string, Promise<void>>();
    /** in-flight abort 컨트롤러 — viewport 를 벗어난 stale 요청 취소용 */
    private inFlightCtrl = new Map<string, AbortController>();
    private seq = 0;

    constructor(
        private versionId: string,
        private callbacks: NetworkTileManagerCallbacks,
        /** dropPayloadAfterLoad: onTileLoaded 후 payload 참조를 버려 heap 절감.
         *  소비자가 evict 정리 정보를 자체 추적할 때만 사용 (onTileEvicted의 payload가 빈 배열이 됨). */
        private options: { dropPayloadAfterLoad?: boolean } = {},
    ) {}

    /** "tx,ty" 타일 키 (경위도 격자 인덱스) */
    private tileKey(tx: number, ty: number): string {
        return `${tx},${ty}`;
    }

    /** EPSG:3857 extent → 겹치는 타일 인덱스 범위 (경위도 격자) */
    private tilesForExtent(extent3857: Extent): { txMin: number; txMax: number; tyMin: number; tyMax: number } {
        const minX = extent3857[0] ?? 0, minY = extent3857[1] ?? 0;
        const maxX = extent3857[2] ?? 0, maxY = extent3857[3] ?? 0;
        const sw = toLonLat([minX, minY]);
        const ne = toLonLat([maxX, maxY]);
        const west = sw[0] ?? 0, south = sw[1] ?? 0;
        const east = ne[0] ?? 0, north = ne[1] ?? 0;
        const D = NETWORK_TILING.TILE_DEG;
        return {
            txMin: Math.floor(west / D),
            txMax: Math.floor(east / D),
            tyMin: Math.floor(south / D),
            tyMax: Math.floor(north / D),
        };
    }

    /** 타일 인덱스 → 그 타일의 경위도 bbox "w,s,e,n" */
    private tileBbox(tx: number, ty: number): string {
        const D = NETWORK_TILING.TILE_DEG;
        const w = tx * D, s = ty * D, e = (tx + 1) * D, n = (ty + 1) * D;
        return `${w},${s},${e},${n}`;
    }

    /**
     * viewport 변화 시 호출 (moveend). 필요한 타일을 fetch 하고 벗어난 타일을 evict 한다.
     * @param extent3857 현재 뷰 extent (EPSG:3857)
     * @param resolution m/px → lod 파라미터 결정
     */
    update(extent3857: Extent, resolution: number): void {
        if (!NETWORK_TILING.ENABLED) return;
        const r = this.tilesForExtent(extent3857);
        this.updateForTileRange(r, networkLodParam(resolution));
    }

    /**
     * 경위도 bbox 직접 지정 (Cesium 등 OL 비의존 소비자용).
     * @param lod NetworkLodTier 또는 서버 lod 파라미터 문자열
     */
    updateForBbox(west: number, south: number, east: number, north: number, lod: string): void {
        const D = NETWORK_TILING.TILE_DEG;
        this.updateForTileRange({
            txMin: Math.floor(west / D), txMax: Math.floor(east / D),
            tyMin: Math.floor(south / D), tyMax: Math.floor(north / D),
        }, lod);
    }

    private updateForTileRange(
        r: { txMin: number; txMax: number; tyMin: number; tyMax: number },
        lod: string,
    ): void {
        const tierOrder = NETWORK_LOD_TIER_ORDER[lod as NetworkLodTier] ?? 99;

        // ── 가드 1: overview/mid(멀리)는 MVT 가 담당 → JSON 타일 매니저는 near 이상에서만 동작 ──
        // (멀리서는 5km 타일이 수천 개가 되어 요청 폭주하므로 fetch 자체를 막는다)
        if (tierOrder < NETWORK_LOD_TIER_ORDER[NETWORK_TILING.JSON_MIN_TIER]) {
            // 멀어졌으므로 보유 타일을 전부 회수 (메모리 부담 0). evictExtra(LRU 한도 초과분만)는
            // 64개 이하면 안 비워 viewport 타일이 남던 버그 → clear()로 전부 비운다.
            this.clear();
            return;
        }

        // detail(완전 근접)은 viewport 가 좁아 5km 타일 1~몇 개에 다 들어가므로 선읽기 불필요.
        // ring=1 이면 주변 8개(각 ~6.8MB)를 미리 받아 줌인이 느려짐 → detail 은 ring=0.
        const ring = tierOrder >= NETWORK_LOD_TIER_ORDER.detail ? 0 : NETWORK_TILING.PREFETCH_RING;

        // ── 가드 2: 타일 수 상한 (안전장치 — 예상치 못한 거대 extent 폭주 방지) ──
        const tileCount = (r.txMax - r.txMin + 1 + 2 * ring) * (r.tyMax - r.tyMin + 1 + 2 * ring);
        if (tileCount > NETWORK_TILING.MAX_TILES_PER_UPDATE) {
            return; // 다음 줌인까지 대기 (기존 타일 유지)
        }

        // 필요한 타일 키 집합 (viewport + prefetch ring)
        const needed = new Set<string>();
        for (let tx = r.txMin - ring; tx <= r.txMax + ring; tx++) {
            for (let ty = r.tyMin - ring; ty <= r.tyMax + ring; ty++) {
                needed.add(this.tileKey(tx, ty));
            }
        }

        const now = ++this.seq;

        // 0) viewport 를 벗어난 in-flight 요청 abort — 줌 애니메이션 중 중간 줌 레벨의
        //    타일 요청 수백 개가 큐잉되어 "무한 로딩" + 브라우저 동시연결(6) 고갈되던 문제.
        for (const [key, ctrl] of this.inFlightCtrl) {
            if (!needed.has(key)) {
                ctrl.abort();
                this.inFlightCtrl.delete(key);
                this.inFlight.delete(key);
            }
        }

        // 1) 필요 타일 fetch (미보유 + 미요청만).
        //    보유 중이라도 더 낮은 tier로 받은 타일(예: near, 차선 stripped)에 detail 요청이 오면
        //    재요청 → 레인이 detail 줌에서 표시되도록. 기존 청크는 새 타일 도착 후 교체
        //    (선-evict 시 도로가 사라졌다 다시 그려져 로딩이 느려 보임 → 무공백 스왑).
        for (const key of needed) {
            const entry = this.tiles.get(key);
            if (entry) {
                entry.lastUsed = now;
                if (entry.tierOrder >= tierOrder) continue;
                if (this.inFlight.has(key)) continue;
                this.fetchTile(key, lod, now, tierOrder); // tier 업그레이드 (소비자가 무공백 스왑)
                continue;
            }
            if (this.inFlight.has(key)) continue;
            this.fetchTile(key, lod, now, tierOrder);
        }

        // 2) evict: 필요하지 않으면서 LRU 한도 초과분 제거
        this.evictExtra(needed);
    }

    private fetchTile(key: string, lod: string, stamp: number, tierOrder: number): void {
        const [tx, ty] = key.split(",").map(Number);
        const bbox = this.tileBbox(tx!, ty!);
        useNetworkTileStore.getState().incLoading(); // 로딩 스피너 (서버 SQLite 재빌드 시 수십 초 걸릴 수 있음)
        const ctrl = new AbortController();
        this.inFlightCtrl.set(key, ctrl);
        const p = axiosInstance
            .get(`/network/${this.versionId}/tiles`, { params: { bbox, lod }, signal: ctrl.signal })
            .then((res) => {
                const payload: NetworkTilePayload = {
                    links: res.data?.links ?? [],
                    nodes: res.data?.nodes ?? [],
                };
                // tier 업그레이드 스왑: onTileEvicted 를 부르지 않고 엔트리만 교체.
                // (여기서 즉시 evict 하면 새 GroundPrimitive 비동기 빌드(수 초) 동안 도로가 사라지는
                //  공백 발생 — 기존 청크의 지연 제거는 소비자(addTileChunk 승격 경로)가 담당)
                this.tiles.set(key, { payload, lastUsed: stamp, tierOrder });
                this.callbacks.onTileLoaded(key, payload, tierOrder);
                // heap 절감: 소비자가 빌드를 마친 뒤 대형 payload(파싱된 링크/노드 JSON) 참조를 버린다.
                // LRU 64타일 × 수 MB가 evict 콜백용으로만 유지되던 것을 제거 (detail 타일 기준 수백 MB).
                if (this.options.dropPayloadAfterLoad) {
                    const entry = this.tiles.get(key);
                    if (entry) entry.payload = { links: [], nodes: [] };
                }
            })
            .catch((err) => {
                // abort(stale)·404·네트워크 오류는 빈 타일로 간주 (캐시에 넣지 않아 재요청 가능)
                const aborted = err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError' || ctrl.signal.aborted;
                if (!aborted && err?.response?.status !== 404) {
                    console.warn(`[NetworkTileManager] 타일 fetch 실패 ${key}`, err);
                }
            })
            .finally(() => {
                this.inFlight.delete(key);
                this.inFlightCtrl.delete(key);
                useNetworkTileStore.getState().decLoading();
            });
        this.inFlight.set(key, p);
    }

    /** 필요 집합 밖 + LRU 한도 초과 타일 evict */
    private evictExtra(needed: Set<string>): void {
        const max = NETWORK_TILING.LRU_MAX_TILES;
        // 필요하지 않은 타일들을 lastUsed 오름차순(오래된 것 먼저)으로 정렬
        const evictable = [...this.tiles.entries()]
            .filter(([k]) => !needed.has(k))
            .sort((a, b) => a[1].lastUsed - b[1].lastUsed);

        // 보유 타일 수가 한도를 넘으면 초과분만큼 오래된 것부터 제거
        let overBy = this.tiles.size - max;
        for (const [key, entry] of evictable) {
            if (overBy <= 0) break;
            this.tiles.delete(key);
            this.callbacks.onTileEvicted(key, entry.payload);
            overBy--;
        }
    }

    /** 보유 타일 수 (테스트/디버그용) */
    get size(): number {
        return this.tiles.size;
    }

    /** 해당 타일을 아직 보유 중인가 (비동기 빌드 중 evict race 방어용) */
    hasTile(key: string): boolean {
        return this.tiles.has(key);
    }

    /** 전체 비우기 (레이어 dispose 시) */
    clear(): void {
        if (this.tiles.size > 0 && import.meta.env?.DEV) {
            console.log(`[mem] 네트워크 타일 ${this.tiles.size}개 전부 evict (메모리 회수)`);
        }
        for (const [key, entry] of this.tiles) {
            this.callbacks.onTileEvicted(key, entry.payload);
        }
        this.tiles.clear();
        for (const ctrl of this.inFlightCtrl.values()) ctrl.abort();
        this.inFlightCtrl.clear();
        this.inFlight.clear();
    }
}
