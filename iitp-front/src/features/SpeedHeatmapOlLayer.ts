import ImageLayer from "ol/layer/Image";
import ImageCanvasSource from "ol/source/ImageCanvas";
import { fromLonLat } from "ol/proj";
import { Cartographic, Ellipsoid, Math as CesiumMath } from "cesium";
import { useNetworkStore } from "@stores/useNetworkStore";
import {
    SPEED_GRID_COLS, SPEED_GRID_ROWS, SPEED_CELL_SIZE_M, SPEED_FREE_FLOW,
} from "@primitives/SpeedHeatmapLayer";

const UPDATE_INTERVAL = 3;
const SPEED_DECAY     = 0.97;
const EMA_BLEND       = 0.35;

/** 네트워크 bbox 중심 → EPSG:3857 [x, y] */
function computeNetworkCenterOl(): [number, number] | null {
    const network = (useNetworkStore.getState().currentJsonData
                  ?? useNetworkStore.getState().originData) as any;
    if (!network?.links?.length) return null;
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    for (const link of network.links) {
        for (const c of (link.coordinates ?? [])) {
            if (c.lat < minLat) minLat = c.lat;
            if (c.lat > maxLat) maxLat = c.lat;
            if (c.lng < minLng) minLng = c.lng;
            if (c.lng > maxLng) maxLng = c.lng;
        }
    }
    if (!isFinite(minLat)) return null;
    return fromLonLat([(minLng + maxLng) / 2, (minLat + maxLat) / 2]) as [number, number];
}

// 속도 비율 + 파동값 → rgba 문자열
// 정체(0): 빨강/불투명 / 자유주행(1): 파랑/반투명 + 물 반짝임
function speedRgba(s: number, ripple: number): string {
    const t = Math.max(0, Math.min(1, s));
    let r: number, g: number, b: number;
    if (t < 0.5) {
        r = 240; g = Math.round(240 * t * 2 * 0.85); b = 25;
    } else {
        r = Math.round(240 * (1 - (t - 0.5) * 2)); g = 200; b = Math.round(25 + (t - 0.5) * 2 * 230);
    }
    // 파동으로 밝기 변조
    const bright = 0.75 + ripple * 0.25;
    r = Math.min(255, Math.round(r * bright));
    g = Math.min(255, Math.round(g * bright));
    b = Math.min(255, Math.round(b * bright));

    const alpha = Math.max(0, Math.min(0.92, 0.90 - t * 0.58 + ripple * 0.08));
    return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
}

/**
 * 속도 히트맵 OL 2D 레이어 – 물 흐름 애니메이션
 * - ImageCanvasSource: requestAnimationFrame 으로 매 프레임 재렌더
 * - 3개 사인파 간섭으로 수면 파동 효과
 */
export default class SpeedHeatmapOlLayer extends ImageLayer<ImageCanvasSource> {
    private speedValues: Float32Array;
    private centerOl: [number, number] | null;

    private latestPositions: (number[] | null)[] | null = null;
    private latestSpeeds:    (number | null)[] | null    = null;
    private frameCount = 0;
    private _source: ImageCanvasSource;

    // 애니메이션
    private _animTime    = 0;
    private _animId      = 0;
    private _destroyed   = false;

    constructor() {
        const centerOl = computeNetworkCenterOl();
        const speedValues = new Float32Array(SPEED_GRID_COLS * SPEED_GRID_ROWS).fill(-1);

        const source = new ImageCanvasSource({
            canvasFunction: (mapExtent, resolution, pixelRatio, size) => {
                return (this as any)._draw(mapExtent, resolution, pixelRatio, size);
            },
            projection: "EPSG:3857",
            ratio: 1,
        });

        super({ source, visible: false, zIndex: 115, opacity: 0.80 });

        this.speedValues = speedValues;
        this.centerOl    = centerOl;
        this._source     = source;

        // 물 흐름 애니메이션 루프 시작
        this._startAnimation();
    }

    // ── 애니메이션 루프 (~30fps) ──────────────────────────────────
    private _startAnimation(): void {
        let lastTs = 0;
        const tick = (now: number) => {
            if (this._destroyed) return;
            if (now - lastTs >= 33) { // ~30fps
                this._animTime += (now - lastTs) / 1000;
                lastTs = now;
                if (this.getVisible()) this._source.changed(); // 재렌더 트리거
            }
            this._animId = requestAnimationFrame(tick);
        };
        this._animId = requestAnimationFrame(tick);
    }

    // ── 렌더 (canvasFunction 콜백) ────────────────────────────────
    private _draw(
        mapExtent: number[],
        resolution: number,
        pixelRatio: number,
        size: number[],
    ): HTMLCanvasElement {
        const canvas = document.createElement("canvas");
        canvas.width  = size[0]!;
        canvas.height = size[1]!;

        if (!this.centerOl) return canvas;

        const ctx = canvas.getContext("2d")!;
        const [cx, cy] = this.centerOl;
        const t = this._animTime;

        for (let gy = 0; gy < SPEED_GRID_ROWS; gy++) {
            for (let gx = 0; gx < SPEED_GRID_COLS; gx++) {
                const s = this.speedValues[gy * SPEED_GRID_COLS + gx]!;
                if (s < 0) continue;

                // 셀 geo 범위 (EPSG:3857)
                const cellX0 = cx + (gx - SPEED_GRID_COLS / 2) * SPEED_CELL_SIZE_M;
                const cellY1 = cy + (gy - SPEED_GRID_ROWS / 2) * SPEED_CELL_SIZE_M;
                const cellX1 = cellX0 + SPEED_CELL_SIZE_M;
                const cellY0 = cellY1 + SPEED_CELL_SIZE_M;

                // 뷰포트 클립
                if (cellX1 < mapExtent[0]! || cellX0 > mapExtent[2]! ||
                    cellY0 < mapExtent[1]! || cellY1 > mapExtent[3]!) continue;

                // EPSG:3857 → canvas 픽셀 (y 반전)
                const px0 = ((cellX0 - mapExtent[0]!) / resolution) * pixelRatio;
                const py0 = ((mapExtent[3]! - cellY0) / resolution) * pixelRatio;
                const pw  = (SPEED_CELL_SIZE_M / resolution) * pixelRatio;
                const ph  = (SPEED_CELL_SIZE_M / resolution) * pixelRatio;

                // 3개 파동 간섭 → 수면 반짝임 (셀 위치 + 시간 기반)
                const uvx = gx / SPEED_GRID_COLS;
                const uvy = gy / SPEED_GRID_ROWS;
                const w1 = Math.sin(uvx * 32.0 + t * 3.2) * 0.5 + 0.5;
                const w2 = Math.cos(uvy * 26.0 - t * 2.2) * 0.5 + 0.5;
                const w3 = Math.sin((uvx + uvy) * 19.0 + t * 4.0) * 0.5 + 0.5;
                const ripple = w1 * 0.40 + w2 * 0.35 + w3 * 0.25;

                ctx.fillStyle = speedRgba(s, ripple);
                ctx.fillRect(px0, py0, pw + 0.5, ph + 0.5);
            }
        }
        return canvas;
    }

    // ── ECEF → EPSG:3857 ──────────────────────────────────────────
    private _ecefToOl(pos: number[]): [number, number] | null {
        try {
            const c = Cartographic.fromCartesian(
                { x: pos[0], y: pos[1], z: pos[2] } as any, Ellipsoid.WGS84);
            return fromLonLat([
                CesiumMath.toDegrees(c.longitude),
                CesiumMath.toDegrees(c.latitude),
            ]) as [number, number];
        } catch { return null; }
    }

    // ── EMA 업데이트 ──────────────────────────────────────────────
    private _updateGrid(positions: (number[] | null)[], speeds: (number | null)[]) {
        if (!this.centerOl) {
            let sx = 0, sy = 0, cnt = 0;
            for (const p of positions) {
                if (!p) continue;
                const ol = this._ecefToOl(p);
                if (!ol) continue;
                sx += ol[0]; sy += ol[1]; cnt++;
            }
            if (cnt > 0) this.centerOl = [sx / cnt, sy / cnt];
            else return;
        }

        for (let i = 0; i < this.speedValues.length; i++) {
            if (this.speedValues[i]! >= 0) this.speedValues[i]! *= SPEED_DECAY;
        }

        const [cx, cy] = this.centerOl;

        for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];
            const spd = speeds ? speeds[i] : null;
            if (!pos || spd == null) continue;

            const ol = this._ecefToOl(pos);
            if (!ol) continue;

            const gx = Math.floor((ol[0] - cx) / SPEED_CELL_SIZE_M + SPEED_GRID_COLS / 2);
            const gy = Math.floor((ol[1] - cy) / SPEED_CELL_SIZE_M + SPEED_GRID_ROWS / 2);
            if (gx < 0 || gx >= SPEED_GRID_COLS || gy < 0 || gy >= SPEED_GRID_ROWS) continue;

            const idx = gy * SPEED_GRID_COLS + gx;
            const ns  = Math.min(spd / SPEED_FREE_FLOW, 1.0);
            this.speedValues[idx] = this.speedValues[idx]! < 0
                ? ns
                : this.speedValues[idx]! * (1 - EMA_BLEND) + ns * EMA_BLEND;
        }
        // (애니메이션 루프에서 source.changed() 호출하므로 여기서 별도 호출 불필요)
    }

    public setLatestPositions(data: { positions: (number[] | null)[]; speeds?: (number | null)[] }) {
        this.latestPositions = data.positions;
        this.latestSpeeds    = data.speeds ?? null;
        this.frameCount++;
        if (this.frameCount % UPDATE_INTERVAL !== 0) return;
        if (this.latestPositions && this.latestSpeeds) {
            this._updateGrid(this.latestPositions, this.latestSpeeds);
        }
    }

    public setSpeed(_s: number) {}
    public setStatus(_s: any) {}

    public setOpacity(opacity: number): void {
        super.setOpacity(Math.max(0, Math.min(1, opacity)));
    }

    public destroy() {
        this._destroyed = true;
        cancelAnimationFrame(this._animId);
        this.speedValues.fill(-1);
    }
}
