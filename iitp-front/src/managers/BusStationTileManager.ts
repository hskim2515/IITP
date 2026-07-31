import { toLonLat } from "ol/proj";
import type { Extent } from "ol/extent";
import { NETWORK_TILING, BUS_STATION_TILING, NETWORK_LOD_TIER_ORDER, getNetworkLodTierByResolution, getNetworkLodTierByViewWidth } from "@utils/lodConstants";
import axiosInstance from "@api/axiosInstance";

/** 버스정류장 타일 페이로드 (PublicTransitResponse.busStations 부분집합) */
export interface BusStationTilePayload {
    busStations: any[];
}

interface TileEntry {
    payload: BusStationTilePayload;
    lastUsed: number;
}

export interface BusStationTileManagerCallbacks {
    onTileLoaded: (tileKey: string, payload: BusStationTilePayload) => void;
    onTileEvicted: (tileKey: string, payload: BusStationTilePayload) => void;
}

/**
 * 버스정류장 BBox 타일 매니저 (읽기 전용). 신호 타일 매니저(SignalTileManager)와 동일
 * 격자(TILE_DEG)·LRU evict 패턴 — 정류장도 lod 분기가 없어 경량 매니저로 둔다.
 *
 * 서버: `GET /public-transit/station/bus/{versionId}/tiles?bbox=west,south,east,north`
 */
export class BusStationTileManager {
    private tiles = new Map<string, TileEntry>();
    private inFlight = new Map<string, Promise<void>>();
    private seq = 0;
    /** 404 = 이 버전에 정류장 파일 자체가 없음 → 카메라 이동마다 타일별 404 재요청 방지. */
    private noStationData = false;

    constructor(
        private versionId: string,
        private callbacks: BusStationTileManagerCallbacks,
    ) {}

    private tileKey(tx: number, ty: number): string { return `${tx},${ty}`; }

    /** moveend 시 호출 — viewport(+ring) 정류장 타일 fetch + LRU evict */
    update(extent3857: Extent, resolution: number): void {
        if (!BUS_STATION_TILING.ENABLED) return;

        const tier = getNetworkLodTierByResolution(resolution);
        if (NETWORK_LOD_TIER_ORDER[tier] < NETWORK_LOD_TIER_ORDER[BUS_STATION_TILING.MIN_TIER]) {
            this.clear();
            return;
        }

        const minX = extent3857[0] ?? 0, minY = extent3857[1] ?? 0;
        const maxX = extent3857[2] ?? 0, maxY = extent3857[3] ?? 0;
        const sw = toLonLat([minX, minY]);
        const ne = toLonLat([maxX, maxY]);
        this.updateForLngLat(sw[0] ?? 0, sw[1] ?? 0, ne[0] ?? 0, ne[1] ?? 0);
    }

    /** 경위도 bbox (Cesium 등 OL 비의존 소비자용). */
    updateForBbox(west: number, south: number, east: number, north: number): void {
        if (!BUS_STATION_TILING.ENABLED) return;
        const midLat = (north + south) / 2;
        const viewWidthM = (east - west) * Math.PI / 180 * 6378137 * Math.cos(midLat * Math.PI / 180);
        const tier = getNetworkLodTierByViewWidth(viewWidthM);
        if (NETWORK_LOD_TIER_ORDER[tier] < NETWORK_LOD_TIER_ORDER[BUS_STATION_TILING.MIN_TIER]) {
            this.clear();
            return;
        }
        this.updateForLngLat(west, south, east, north);
    }

    private updateForLngLat(west: number, south: number, east: number, north: number): void {
        if (this.noStationData) return;
        const D = NETWORK_TILING.TILE_DEG, ring = NETWORK_TILING.PREFETCH_RING;
        const txMin = Math.floor(west / D), txMax = Math.floor(east / D);
        const tyMin = Math.floor(south / D), tyMax = Math.floor(north / D);

        const tileCount = (txMax - txMin + 1 + 2 * ring) * (tyMax - tyMin + 1 + 2 * ring);
        if (tileCount > NETWORK_TILING.MAX_TILES_PER_UPDATE) return;

        const needed = new Set<string>();
        for (let tx = txMin - ring; tx <= txMax + ring; tx++)
            for (let ty = tyMin - ring; ty <= tyMax + ring; ty++)
                needed.add(this.tileKey(tx, ty));

        const now = ++this.seq;
        for (const key of needed) {
            const entry = this.tiles.get(key);
            if (entry) { entry.lastUsed = now; continue; }
            if (this.inFlight.has(key)) continue;
            this.fetchTile(key, now);
        }
        this.evictExtra(needed);
    }

    private fetchTile(key: string, stamp: number): void {
        const [tx, ty] = key.split(",").map(Number);
        const D = NETWORK_TILING.TILE_DEG;
        const bbox = `${tx! * D},${ty! * D},${(tx! + 1) * D},${(ty! + 1) * D}`;
        const p = axiosInstance
            .get(`/public-transit/station/bus/${this.versionId}/tiles`, { params: { bbox } })
            .then((res) => {
                const payload: BusStationTilePayload = { busStations: res.data?.busStations ?? [] };
                this.tiles.set(key, { payload, lastUsed: stamp });
                this.callbacks.onTileLoaded(key, payload);
            })
            .catch((err) => {
                if (err?.response?.status === 404) {
                    this.noStationData = true;
                } else {
                    console.warn(`[BusStationTileManager] 타일 fetch 실패 ${key}`, err);
                }
            })
            .finally(() => { this.inFlight.delete(key); });
        this.inFlight.set(key, p);
    }

    private evictExtra(needed: Set<string>): void {
        const max = NETWORK_TILING.LRU_MAX_TILES;
        const evictable = [...this.tiles.entries()]
            .filter(([k]) => !needed.has(k))
            .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
        let overBy = this.tiles.size - max;
        for (const [key, entry] of evictable) {
            if (overBy <= 0) break;
            this.tiles.delete(key);
            this.callbacks.onTileEvicted(key, entry.payload);
            overBy--;
        }
    }

    clear(): void {
        for (const [key, entry] of this.tiles) this.callbacks.onTileEvicted(key, entry.payload);
        this.tiles.clear();
        this.inFlight.clear();
        this.noStationData = false;
    }
}
