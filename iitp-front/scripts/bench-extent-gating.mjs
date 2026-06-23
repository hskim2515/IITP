// Extent 게이팅 성능 벤치마크 (실제 ol 라이브러리 사용)
// NetworkFeatureLayer의 reconcile/syncGroup/공간인덱스 로직을 그대로 복제해
// 도시 규모(수만 링크)에서 moveend당 비용을 측정한다.
//
// 실행: node scripts/bench-extent-gating.mjs

import VectorSource from 'ol/source/Vector.js';
import { Feature } from 'ol';
import { LineString, Point, Polygon } from 'ol/geom.js';
import { buffer, containsCoordinate, createEmpty, extend, getHeight, getWidth, intersects } from 'ol/extent.js';

// ── lodConstants.ts 복제 ──
const NETWORK_LOD_TIER_ORDER = { overview: 0, mid: 1, near: 2, detail: 3 };
const NETWORK_FEATURE_MIN_TIER = {
    'link-edit': 0, 'links': 1, 'nodes': 1, 'connections': 2, 'ports': 2,
    'lanes': 3, 'lane-edit': 3, 'cells': 3, 'segments': 3,
};
const LOD_RES = { NETWORK_LANE_DETAIL: 0.3, NETWORK_LINK_ONLY: 2, NETWORK_OUTLINE_ONLY: 8 };
const RENDER_BUFFER_RATIO = 0.5;

function getNetworkLodTierByResolution(res) {
    if (res > LOD_RES.NETWORK_OUTLINE_ONLY) return 'overview';
    if (res > LOD_RES.NETWORK_LINK_ONLY) return 'mid';
    if (res > LOD_RES.NETWORK_LANE_DETAIL) return 'near';
    return 'detail';
}
function isNetworkFeatureVisibleAtTier(type, tier) {
    const m = NETWORK_FEATURE_MIN_TIER[type];
    if (m === undefined) return true;
    return NETWORK_LOD_TIER_ORDER[tier] >= m;
}

// ── 합성 도시 네트워크: 격자형 도로망 (현실적 분포) ──
// EPSG:3857 대략 한국 좌표대 근처. 격자 간격 ~120m.
function buildSyntheticFeatures(nLinks) {
    const linkFeaturesMap = new Map();
    const nodeFeaturesMap = new Map();
    const cols = Math.ceil(Math.sqrt(nLinks / 2));
    const SP = 120; // 노드 간 간격(m)
    const ORIGIN_X = 14100000, ORIGIN_Y = 4500000;

    let linkId = 0, nodeId = 0;
    // 노드: 격자 교점
    const nodeAt = new Map(); // "r,c" -> {id, x, y}
    for (let r = 0; r <= cols; r++) {
        for (let c = 0; c <= cols; c++) {
            const x = ORIGIN_X + c * SP, y = ORIGIN_Y + r * SP;
            const id = String(nodeId++);
            nodeAt.set(`${r},${c}`, { id, x, y });
        }
    }
    // 노드 피처: 점 + 평균 4커넥션 + 4포트(=점/정지선)
    for (const n of nodeAt.values()) {
        const feats = [];
        feats.push(new Feature({ geometry: new Point([n.x, n.y]), featureType: 'nodes' }));
        for (let k = 0; k < 4; k++) {
            feats.push(new Feature({ geometry: new LineString([[n.x, n.y], [n.x + 8, n.y + 8]]), featureType: 'connections' }));
            feats.push(new Feature({ geometry: new Point([n.x + 5, n.y]), featureType: 'ports' }));
            feats.push(new Feature({ geometry: new LineString([[n.x - 3, n.y], [n.x + 3, n.y]]), featureType: 'ports' }));
        }
        nodeFeaturesMap.set(n.id, feats);
    }
    // 링크: 인접 노드 연결 (수평+수직), 링크당 평균 2.6 lane
    const dirs = [[0, 1], [1, 0]];
    outer:
    for (let r = 0; r <= cols; r++) {
        for (let c = 0; c <= cols; c++) {
            const a = nodeAt.get(`${r},${c}`);
            if (!a) continue;
            for (const [dr, dc] of dirs) {
                const b = nodeAt.get(`${r + dr},${c + dc}`);
                if (!b) continue;
                if (linkId >= nLinks) break outer;
                const id = String(linkId++);
                const lanes = 2 + (linkId % 2); // 2~3 lane
                const feats = [];
                const pts = [[a.x, a.y], [(a.x + b.x) / 2, (a.y + b.y) / 2], [b.x, b.y]];
                feats.push(new Feature({ geometry: new LineString(pts), featureType: 'link-edit' }));
                const w = 3.5 * lanes;
                feats.push(new Feature({ geometry: new Polygon([[[a.x, a.y - w/2], [b.x, b.y - w/2], [b.x, b.y + w/2], [a.x, a.y + w/2], [a.x, a.y - w/2]]]), featureType: 'links' }));
                for (let l = 0; l < lanes; l++) {
                    feats.push(new Feature({ geometry: new Polygon([[[a.x, a.y], [b.x, b.y], [b.x, b.y + 3], [a.x, a.y + 3], [a.x, a.y]]]), featureType: 'lanes', laneRef: l }));
                    feats.push(new Feature({ geometry: new LineString([[a.x, a.y + l], [b.x, b.y + l]]), featureType: 'lane-edit' }));
                }
                linkFeaturesMap.set(id, feats);
            }
        }
    }
    return { linkFeaturesMap, nodeFeaturesMap, extentCenter: [ORIGIN_X + cols * SP / 2, ORIGIN_Y + cols * SP / 2], citySpan: cols * SP };
}

// ── 공간 인덱스 (rebuildSpatialIndex 복제) ──
function buildIndex(linkFeaturesMap, nodeFeaturesMap) {
    const linkExtentMap = new Map();
    const nodeCoordMap = new Map();
    for (const [id, features] of linkFeaturesMap) {
        const ext = createEmpty();
        for (const f of features) { const g = f.getGeometry(); if (g) extend(ext, g.getExtent()); }
        linkExtentMap.set(id, ext);
    }
    for (const [id, features] of nodeFeaturesMap) {
        const nf = features.find(f => f.get('featureType') === 'nodes');
        const g = nf?.getGeometry();
        if (g instanceof Point) nodeCoordMap.set(id, g.getCoordinates());
    }
    return { linkExtentMap, nodeCoordMap };
}

// ── syncGroup 복제 ──
function syncGroup(source, bucket, id, desired, force) {
    const cur = bucket.get(id) ?? [];
    if (desired.length === 0) {
        if (cur.length > 0) { source.removeFeatures(cur); bucket.delete(id); }
        return;
    }
    if (!force && cur.length === desired.length) {
        let same = true;
        for (let i = 0; i < cur.length; i++) if (cur[i] !== desired[i]) { same = false; break; }
        if (same) return;
    }
    const curSet = new Set(cur), desSet = new Set(desired);
    const toRemove = cur.filter(f => !desSet.has(f));
    const toAdd = desired.filter(f => !curSet.has(f));
    if (toRemove.length) source.removeFeatures(toRemove);
    if (toAdd.length) source.addFeatures(toAdd);
    bucket.set(id, desired);
}

// ── reconcile 복제 ──
function reconcile(state, viewExtentRaw, resolution) {
    const { source, linkFeaturesMap, nodeFeaturesMap, linkExtentMap, nodeCoordMap, addedLink, addedNode } = state;
    const tier = getNetworkLodTierByResolution(resolution);
    const margin = Math.max(getWidth(viewExtentRaw), getHeight(viewExtentRaw)) * RENDER_BUFFER_RATIO;
    const ext = buffer(viewExtentRaw, margin);
    const tierChanged = tier !== state.lastTier;

    for (const [id, features] of linkFeaturesMap) {
        const lext = linkExtentMap.get(id);
        const inView = lext ? intersects(ext, lext) : true;
        const desired = inView ? features.filter(f => isNetworkFeatureVisibleAtTier(f.get('featureType'), tier)) : [];
        syncGroup(source, addedLink, id, desired, tierChanged);
    }
    for (const [id, features] of nodeFeaturesMap) {
        const coord = nodeCoordMap.get(id);
        const inView = coord ? containsCoordinate(ext, coord) : true;
        const desired = inView ? features.filter(f => isNetworkFeatureVisibleAtTier(f.get('featureType'), tier)) : [];
        syncGroup(source, addedNode, id, desired, tierChanged);
    }
    state.lastTier = tier;
}

function totalFeatures(linkFeaturesMap, nodeFeaturesMap) {
    let n = 0;
    for (const f of linkFeaturesMap.values()) n += f.length;
    for (const f of nodeFeaturesMap.values()) n += f.length;
    return n;
}

function bench(nLinks) {
    const t0 = performance.now();
    const { linkFeaturesMap, nodeFeaturesMap, extentCenter, citySpan } = buildSyntheticFeatures(nLinks);
    const tBuild = performance.now() - t0;

    const t1 = performance.now();
    const { linkExtentMap, nodeCoordMap } = buildIndex(linkFeaturesMap, nodeFeaturesMap);
    const tIndex = performance.now() - t1;

    const source = new VectorSource();
    const state = {
        source, linkFeaturesMap, nodeFeaturesMap, linkExtentMap, nodeCoordMap,
        addedLink: new Map(), addedNode: new Map(), lastTier: null,
    };

    const totalFeat = totalFeatures(linkFeaturesMap, nodeFeaturesMap);

    // 뷰포트: 1200x900px. "near" tier(res=1.0 m/px) → 화면 1200m x 900m (근접, 차선 보임)
    const res = 1.0; // m/px → near tier
    const halfW = 1200 * res / 2, halfH = 900 * res / 2;
    const [cx, cy] = extentCenter;
    const viewNear = [cx - halfW, cy - halfH, cx + halfW, cy + halfH];

    // (a) 첫 reconcile (cold: tier 진입 + 전체 인덱스 스캔, source 채우기)
    const t2 = performance.now();
    reconcile(state, viewNear, res);
    const tFirst = performance.now() - t2;
    const srcAfterNear = source.getFeatures().length;

    // (b) 작은 팬 (warm: 대부분 그룹 변화 없음 → syncGroup 조기 return) — 10회 평균
    let tPanSum = 0;
    for (let i = 1; i <= 10; i++) {
        const off = i * 20;
        const panned = [cx - halfW + off, cy - halfH + off, cx + halfW + off, cy + halfH + off];
        const t3 = performance.now();
        reconcile(state, panned, res);
        tPanSum += performance.now() - t3;
    }
    const tPan = tPanSum / 10;

    // (c) overview tier로 줌아웃 (tier change → 전체 resync, 도시 전체가 extent에 들어옴)
    const resOverview = 12; // overview tier
    const ohw = 1200 * resOverview / 2, ohh = 900 * resOverview / 2;
    const viewOverview = [cx - ohw, cy - ohh, cx + ohw, cy + ohh];
    const t4 = performance.now();
    reconcile(state, viewOverview, resOverview);
    const tOverview = performance.now() - t4;
    const srcAfterOverview = source.getFeatures().length;

    // (d) 다시 near로 줌인 (tier change)
    const t5 = performance.now();
    reconcile(state, viewNear, res);
    const tBackToNear = performance.now() - t5;

    return {
        nLinks, nNodes: nodeFeaturesMap.size, totalFeat, citySpanKm: (citySpan / 1000).toFixed(1),
        tBuild, tIndex, tFirst, tPan, tOverview, tBackToNear,
        srcNear: srcAfterNear, srcOverview: srcAfterOverview,
        pctNear: ((srcAfterNear / totalFeat) * 100).toFixed(1),
        pctOverview: ((srcAfterOverview / totalFeat) * 100).toFixed(1),
    };
}

const ms = (x) => x.toFixed(1).padStart(8);
console.log('\n=== Extent 게이팅 성능 벤치마크 (실제 ol 라이브러리) ===\n');
console.log('규모        총피처    도시폭   인덱스(ms)  첫reconcile  작은팬   줌아웃(tier변경)  줌인(tier변경) | source: near/overview');
console.log('─'.repeat(130));
for (const n of [330, 2000, 10000, 30000, 100000]) {
    const r = bench(n);
    const label = (n >= 1000 ? (n/1000)+'k' : ''+n) + ' links';
    console.log(
        `${label.padEnd(11)} ${String(r.totalFeat).padStart(8)} ${(r.citySpanKm+'km').padStart(7)} ` +
        `${ms(r.tIndex)} ${ms(r.tFirst)} ${ms(r.tPan)} ${ms(r.tOverview)} ${ms(r.tBackToNear)}    | ` +
        `${r.srcNear}(${r.pctNear}%) / ${r.srcOverview}(${r.pctOverview}%)`
    );
}
console.log('\n* 첫reconcile/줌아웃/줌인 = tier 변경 시 전체 재동기화(최악). 작은 팬 = 일반 moveend(대부분 조기 return).');
console.log('* source 비율 = 도시 전체 피처 대비 실제 화면에 올라간 피처 수 (게이팅 효과).\n');
