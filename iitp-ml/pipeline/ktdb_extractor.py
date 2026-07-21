"""
표준노드링크 SHP → 교차로 판별 → 링크 절단 + Connection 생성

network.xml 규칙 적용:
  - 노드 타입: intersection / normal / merging / diverging
  - 모든 노드에 connection 생성 (비교차로: length=0 through-connection)
  - per-lane connection (fromLane / toLane)
  - 링크에 stopLine, length 필드
  - 교차로 진입 링크: setback 적용 → 정지선 위치 절단
"""
from __future__ import annotations

import logging
import math
import os
from collections import defaultdict
from typing import Any

from pyproj import CRS as ProjCRS, Transformer
from shapely.geometry import Point, box, shape
from shapely.strtree import STRtree

log = logging.getLogger("iitp-ml")


# ── CRS 헬퍼 ─────────────────────────────────────────────────────────────────

def _make_transformer(src) -> Transformer | None:
    try:
        src_crs = ProjCRS.from_wkt(src.crs.to_wkt())
        if src_crs.is_geographic:
            return None
        return Transformer.from_crs(src_crs, 4326, always_xy=True)
    except Exception:
        pass
    return Transformer.from_crs(5186, 4326, always_xy=True)


def _xy(tr: Transformer | None, x: float, y: float) -> tuple[float, float]:
    return tr.transform(x, y) if tr else (x, y)


# ── 기하 헬퍼 ─────────────────────────────────────────────────────────────────

def _bearing(c1: dict, c2: dict) -> float:
    dlon = math.radians(c2["lng"] - c1["lng"])
    rlat1, rlat2 = math.radians(c1["lat"]), math.radians(c2["lat"])
    x = math.sin(dlon) * math.cos(rlat2)
    y = math.cos(rlat1) * math.sin(rlat2) - math.sin(rlat1) * math.cos(rlat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _haversine_m(p1: dict, p2: dict) -> float:
    R = 6_371_000.0
    dlat = math.radians(p2["lat"] - p1["lat"])
    dlon = math.radians(p2["lng"] - p1["lng"])
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(p1["lat"])) * math.cos(math.radians(p2["lat"]))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _link_length(coords: list[dict]) -> float:
    return sum(_haversine_m(coords[k], coords[k + 1])
               for k in range(len(coords) - 1))


def _angle_diff(b1: float, b2: float) -> float:
    return min(abs(b1 - b2) % 360, 360 - abs(b1 - b2) % 360)


def _turn_direction(in_bearing: float, out_bearing: float) -> str:
    diff = (out_bearing - in_bearing + 360) % 360
    if diff < 45 or diff > 315:
        return "S"
    elif diff <= 180:
        return "R"
    else:
        return "L"


# ── 교차로 판별 ───────────────────────────────────────────────────────────────

def _is_intersection(
    node_id: str,
    in_link_list: list,
    out_link_list: list,
    turninfo: dict,
) -> bool:
    if node_id in turninfo:
        return True

    total = len(in_link_list) + len(out_link_list)
    if total >= 3:
        return True

    if len(in_link_list) == 1 and len(out_link_list) == 1:
        in_coords  = in_link_list[0][1]
        out_coords = out_link_list[0][1]
        if len(in_coords) >= 2 and len(out_coords) >= 2:
            b_in  = _bearing(in_coords[-2],  in_coords[-1])
            b_out = _bearing(out_coords[0], out_coords[1])
            if _angle_diff(b_in, b_out) < 30:
                return False
        return True

    return False


def _short_cycle_internals(
    directed_adj: dict[str, list[str]],
    max_cycle_len: int = 5,
) -> set[tuple[str, str]]:
    """
    방향 그래프에서 "교차로 내부 링크"를 식별.

    링크 A→B가 "진짜 내부 링크"인 조건:
      B에서 candidate-internal 링크만을 따라 A에 (max_cycle_len-1)홉 이내에 도달 가능.

    원리:
      - 실제 교차로 내부 사이클은 4거리=4홉, 6거리=6홉 등 작은 사이클로 구성됨
      - 두 교차로 사이를 연결하는 도로: 양방향이더라도 왕복 사이클이
        (교차로A 내부 ~4홉) + 연결도로 왕복 (2홉) + (교차로B 내부 ~4홉) = 10홉+
        이상이므로 max_cycle_len=6이면 제외됨

    반환: {(from, to)} 형태의 진짜 내부 링크 집합.
    """
    internals: set[tuple[str, str]] = set()

    for a in directed_adj:
        for b in directed_adj[a]:
            # BFS from b, look for a within (max_cycle_len-1) hops
            visited: dict[str, int] = {b: 0}
            queue = [b]
            qi = 0
            found = False
            while qi < len(queue) and not found:
                cur = queue[qi]
                qi += 1
                depth = visited[cur]
                if depth >= max_cycle_len - 1:
                    continue
                for nxt in directed_adj.get(cur, []):
                    if nxt == a:
                        found = True
                        break
                    if nxt not in visited:
                        visited[nxt] = depth + 1
                        queue.append(nxt)
            if found:
                internals.add((a, b))

    return internals


def _lane_pairs(turning: str, in_lanes: int, out_lanes: int) -> list[tuple[int, int]]:
    """
    turning 방향에 따른 (from_lane, to_lane) 쌍 목록.

    규칙 (network.xml 패턴 기반):
      L  → 가장 왼쪽 차선(0)끼리만 연결  → [(0, 0)]
      R  → 가장 오른쪽 차선끼리만 연결   → [(in_lanes-1, out_lanes-1)]
      S  → 1:1 순서 매핑, 차선 수 불일치 시 경계 차선으로 흡수
           - 합류(in > out): 초과 in 차선 → 마지막 out 차선
           - 분기(in < out): 초과 out 차선 ← 마지막 in 차선
    """
    if turning == "L":
        return [(0, 0)]
    if turning == "R":
        return [(in_lanes - 1, out_lanes - 1)]
    # S: 1:1 매핑 후 나머지 차선을 경계 차선으로 흡수
    count = min(in_lanes, out_lanes)
    pairs = [(k, k) for k in range(count)]
    # 합류: 초과 in 차선 → 마지막 out 차선
    for k in range(count, in_lanes):
        pairs.append((k, out_lanes - 1))
    # 분기: 초과 out 차선 ← 마지막 in 차선
    for k in range(count, out_lanes):
        pairs.append((in_lanes - 1, k))
    return pairs


def _node_type(n_in: int, n_out: int, is_inter: bool) -> str:
    if is_inter:
        return "intersection"
    if n_in == 1 and n_out == 1:
        return "normal"
    if n_in > n_out:
        return "merging"
    if n_out > n_in:
        return "diverging"
    return "normal"


# ── 링크 절단 ─────────────────────────────────────────────────────────────────

def _setback_dist(approach_bearing: float, crossing_links: list[tuple[float, float]]) -> float:
    setback = 3.0
    for other_bearing, other_width in crossing_links:
        angle = _angle_diff(approach_bearing, other_bearing)
        sin_a = abs(math.sin(math.radians(angle)))
        if sin_a < 0.15:
            continue
        setback = max(setback, (other_width / 2.0) / sin_a)
    return min(setback, 30.0)


def _trim_end(coords: list[dict], dist_m: float) -> list[dict]:
    if dist_m <= 0 or len(coords) < 2:
        return coords
    result = list(coords)
    remaining = dist_m
    while len(result) >= 2 and remaining > 0:
        seg = _haversine_m(result[-2], result[-1])
        if seg <= remaining:
            remaining -= seg
            result.pop()
        else:
            frac = remaining / seg
            p1, p2 = result[-2], result[-1]
            result[-1] = {
                "lng": p2["lng"] + frac * (p1["lng"] - p2["lng"]),
                "lat": p2["lat"] + frac * (p1["lat"] - p2["lat"]),
            }
            break
    return result if len(result) >= 2 else coords


def _trim_start(coords: list[dict], dist_m: float) -> list[dict]:
    if dist_m <= 0 or len(coords) < 2:
        return coords
    result = list(coords)
    remaining = dist_m
    while len(result) >= 2 and remaining > 0:
        seg = _haversine_m(result[0], result[1])
        if seg <= remaining:
            remaining -= seg
            result.pop(0)
        else:
            frac = remaining / seg
            p1, p2 = result[0], result[1]
            result[0] = {
                "lng": p1["lng"] + frac * (p2["lng"] - p1["lng"]),
                "lat": p1["lat"] + frac * (p2["lat"] - p1["lat"]),
            }
            break
    return result if len(result) >= 2 else coords


def _apply_setbacks(
    links_raw: list[dict],
    node_coord: dict[str, tuple[float, float]],
    intersection_nodes: set[str],
) -> dict[int, float]:
    """
    교차로 노드에 연결된 링크에만 setback 적용.
    반환: link_idx → stop_line_dist (m) 딕셔너리 (끝쪽 절단 거리)
    """
    node_to_links: dict[str, list[tuple[int, str, float, float]]] = defaultdict(list)
    for j, lk in enumerate(links_raw):
        coords = lk["coords"]
        if len(coords) < 2:
            continue
        b_in  = _bearing(coords[-2], coords[-1])
        b_out = _bearing(coords[0],  coords[1])
        node_to_links[lk["t_node"]].append((j, "end",   b_in,  lk["width"]))
        node_to_links[lk["f_node"]].append((j, "start", b_out, lk["width"]))

    stop_line_dists: dict[int, float] = {}

    for node_id, link_list in node_to_links.items():
        if node_id not in intersection_nodes:
            continue
        if node_id not in node_coord:
            continue

        for j, end_type, bearing, width in link_list:
            others = [(b, w) for jj, _, b, w in link_list if jj != j]
            dist = _setback_dist(bearing, others)

            if end_type == "end":
                links_raw[j]["coords"] = _trim_end(links_raw[j]["coords"], dist)
                stop_line_dists[j] = round(dist, 3)
            else:
                links_raw[j]["coords"] = _trim_start(links_raw[j]["coords"], dist)

    return stop_line_dists


# ── KtdbIndex ─────────────────────────────────────────────────────────────────

class KtdbIndex:
    def __init__(self) -> None:
        self.links: list[dict] = []
        self.nodes: dict[str, tuple[float, float]] = {}
        self.turninfo: dict[str, dict[tuple[str, str], str]] = defaultdict(dict)
        self._tree: STRtree | None = None

    @classmethod
    def build(cls, node_shp_path: str, link_shp_path: str) -> "KtdbIndex":
        import fiona
        idx = cls()

        log.info("전국 링크 로드 중: %s", link_shp_path)
        midpoints: list[Point] = []
        with fiona.open(link_shp_path, "r") as src:
            tr = _make_transformer(src)
            for feat in src:
                props = feat["properties"]
                try:
                    geom = shape(feat["geometry"])
                    mid = geom.interpolate(0.5, normalized=True)
                    mlon, mlat = _xy(tr, mid.x, mid.y)
                    coords = [{"lng": _xy(tr, x, y)[0], "lat": _xy(tr, x, y)[1]}
                               for x, y in geom.coords]
                    lanes = int(props.get("LANES", props.get("lanes", 1)) or 1)
                    # KTDB에 WIDTH 필드 없음 → 도로등급별 차선폭 × 차선수로 계산
                    # ROAD_RANK: 102=고속, 103=국도, 104=특별광역시도, 105=지방도,
                    #            106=시도, 107=군도, 108=구도
                    road_rank = int(props.get("ROAD_RANK", props.get("road_rank", 106)) or 106)
                    _lane_w = {102: 3.5, 103: 3.25, 104: 3.0, 105: 3.0,
                               106: 3.0, 107: 2.75, 108: 2.75}.get(road_rank, 3.0)
                    width = lanes * _lane_w
                    idx.links.append({
                        "ktdb_id"  : str(props.get("LINK_ID", props.get("link_id", ""))),
                        "f_node"   : str(props.get("F_NODE",  props.get("f_node",  ""))),
                        "t_node"   : str(props.get("T_NODE",  props.get("t_node",  ""))),
                        "lanes"    : lanes,
                        "max_spd"  : float(props.get("MAX_SPD", props.get("max_spd", 50)) or 50),
                        "width"    : width,
                        "road_rank": road_rank,
                        "coords"   : coords,
                        "_mid"     : (mlon, mlat),
                    })
                    midpoints.append(Point(mlon, mlat))
                except Exception:
                    continue

        log.info("STRtree 구축 중 (링크 %d개)...", len(idx.links))
        idx._tree = STRtree(midpoints)

        log.info("전국 노드 로드 중: %s", node_shp_path)
        with fiona.open(node_shp_path, "r") as src:
            tr = _make_transformer(src)
            for feat in src:
                props = feat["properties"]
                node_id = str(props.get("NODE_ID", props.get("node_id", "")))
                try:
                    geom = shape(feat["geometry"])
                    idx.nodes[node_id] = _xy(tr, geom.x, geom.y)
                except Exception:
                    try:
                        x = float(props.get("X_COORD", props.get("x_coord", 0)))
                        y = float(props.get("Y_COORD", props.get("y_coord", 0)))
                        idx.nodes[node_id] = _xy(tr, x, y)
                    except Exception:
                        continue

        turninfo_path = os.path.join(os.path.dirname(node_shp_path), "TURNINFO.dbf")
        if os.path.isfile(turninfo_path):
            try:
                with fiona.open(turninfo_path, "r") as src:
                    for feat in src:
                        p    = feat["properties"]
                        nid  = str(p.get("NODE_ID",   ""))
                        st   = str(p.get("ST_LINK",   ""))
                        ed   = str(p.get("ED_LINK",   ""))
                        tt   = str(p.get("TURN_TYPE", "0"))
                        oper = str(p.get("TURN_OPER", "0"))
                        if oper == "1":
                            continue
                        direction = {"0": "S", "1": "R", "2": "L"}.get(
                            tt[0] if tt else "0", "S")
                        idx.turninfo[nid][(st, ed)] = direction
                log.info("TURNINFO 로드 완료")
            except Exception as e:
                log.warning("TURNINFO 로드 실패: %s", e)

        log.info("KTDB 인덱스 준비 완료: 링크 %d개, 노드 %d개",
                 len(idx.links), len(idx.nodes))
        return idx

    def query_links(self, west: float, south: float,
                    east: float, north: float) -> list[int]:
        bbox_geom = box(west, south, east, north)
        candidates = self._tree.query(bbox_geom)
        return [
            int(i) for i in candidates
            if west <= self.links[i]["_mid"][0] <= east
            and south <= self.links[i]["_mid"][1] <= north
        ]


# ── extract_network ───────────────────────────────────────────────────────────

def extract_network(
    index: KtdbIndex,
    west: float, south: float,
    east: float, north: float,
) -> dict[str, Any]:
    """
    표준노드링크 bbox → NetworkResponse dict (network.xml 구조 준수)

    교차로 클러스터링:
      1. 교차로 후보 노드 판별 (3+ 링크 또는 TURNINFO 등재)
      2. "내부 링크" = f_node 와 t_node 둘 다 교차로 후보인 링크
         → 이 링크들이 KTDB에서 교차로 내부를 표현
      3. 내부 링크로 연결된 교차로 노드를 BFS로 클러스터링
      4. 클러스터 → centroid 1개 노드로 병합
      5. 내부 링크 → Connection (실제 경로 좌표 사용)
      6. 외부 링크 → centroid 노드로 연결, setback 적용
    """

    # ── 1. 링크 조회 ──────────────────────────────────────────────────────────
    link_indices = index.query_links(west, south, east, north)
    links_raw = [
        {**lk, "coords": list(lk["coords"])}
        for lk in (index.links[i] for i in link_indices)
    ]
    if not links_raw:
        return {"nodes": [], "links": [],
                "originLat": (south + north) / 2,
                "originLng": (west  + east)  / 2}

    # ── 2. 노드 수집 ──────────────────────────────────────────────────────────
    used_node_ids: set[str] = (
        {lk["f_node"] for lk in links_raw} |
        {lk["t_node"] for lk in links_raw}
    )
    node_coord: dict[str, tuple[float, float]] = {
        nid: index.nodes[nid]
        for nid in used_node_ids if nid in index.nodes
    }

    # ── 3. 노드별 연결 링크 수집 ──────────────────────────────────────────────
    in_links_raw:  dict[str, list[tuple[int, list]]] = defaultdict(list)
    out_links_raw: dict[str, list[tuple[int, list]]] = defaultdict(list)
    for j, lk in enumerate(links_raw):
        in_links_raw[lk["t_node"]].append((j, lk["coords"]))
        out_links_raw[lk["f_node"]].append((j, lk["coords"]))

    # ── 4. 교차로 후보 노드 판별 ──────────────────────────────────────────────
    inter_candidates: set[str] = set()
    for nid in node_coord:
        if _is_intersection(
            nid,
            in_links_raw.get(nid,  []),
            out_links_raw.get(nid, []),
            index.turninfo,
        ):
            inter_candidates.add(nid)

    # ── 5. 내부 링크 식별 & 클러스터링 ──────────────────────────────────────
    # 후보: f_node, t_node 모두 교차로 후보인 링크
    candidate_internal: list[tuple[int, str, str]] = []   # (j, fn, tn)
    directed_cand_adj: dict[str, list[str]] = defaultdict(list)
    for j, lk in enumerate(links_raw):
        fn, tn = lk["f_node"], lk["t_node"]
        if fn in inter_candidates and tn in inter_candidates:
            candidate_internal.append((j, fn, tn))
            directed_cand_adj[fn].append(tn)

    # 단방향 짧은-사이클 검사:
    #   A→B가 진짜 내부 링크 ↔ B→(내부링크만)→A 경로가 5홉 이내에 존재
    #   - 교차로 내부 사이클: 4거리=3홉 반환, 5거리=4홉 반환 → max=5로 캡처
    #   - 인접 교차로 간 연결 도로: 왕복 경로 = I1내부(3홉)+도로(1홉)+I2내부(3홉) = 7홉+ → 제외
    #   - max=6은 너무 커서 중간 노드가 없는 인접 교차로까지 병합됨 (실측 확인)
    true_internal_edges = _short_cycle_internals(directed_cand_adj, max_cycle_len=5)

    internal_link_idxs: set[int] = set()
    internal_adj: dict[str, set[str]] = defaultdict(set)
    for j, fn, tn in candidate_internal:
        if (fn, tn) in true_internal_edges:
            internal_link_idxs.add(j)
            internal_adj[fn].add(tn)
            internal_adj[tn].add(fn)  # 클러스터링은 무방향으로

    # BFS로 내부 링크 기반 클러스터 구성
    visited: set[str] = set()
    clusters: list[set[str]] = []
    for start in inter_candidates:
        if start in visited:
            continue
        cluster: set[str] = set()
        queue = [start]
        while queue:
            nid = queue.pop()
            if nid in visited:
                continue
            visited.add(nid)
            cluster.add(nid)
            queue.extend(internal_adj[nid] - visited)
        clusters.append(cluster)

    # 클러스터 인덱스 매핑: ktdb_node_id → cluster_idx
    node_to_cluster: dict[str, int] = {}
    for ci, cluster in enumerate(clusters):
        for nid in cluster:
            node_to_cluster[nid] = ci

    # 클러스터 centroid 좌표
    cluster_centroid: list[tuple[float, float]] = []
    for cluster in clusters:
        pts = [index.nodes[n] for n in cluster if n in index.nodes]
        cluster_centroid.append((
            sum(p[0] for p in pts) / len(pts),
            sum(p[1] for p in pts) / len(pts),
        ))

    log.info("교차로 후보 노드: %d개, 클러스터: %d개, 비교차로 노드: %d개",
             len(inter_candidates),
             len(clusters),
             len(node_coord) - len(inter_candidates))

    # ── 6. 출력 노드 목록 구성 ────────────────────────────────────────────────
    # 비교차로 노드 → 그대로 출력, 교차로 클러스터 → centroid 1개
    out_nodes: list[dict] = []          # {lon, lat, is_inter, ci}
    ktdb_to_out: dict[str, int] = {}    # ktdb_node_id → 출력 노드 인덱스

    # 비교차로 노드
    for nid in node_coord:
        if nid in inter_candidates:
            continue
        lon, lat = node_coord[nid]
        oid = len(out_nodes)
        ktdb_to_out[nid] = oid
        out_nodes.append({"lon": lon, "lat": lat, "is_inter": False, "ci": -1})

    # 교차로 클러스터 centroid (클러스터당 1개)
    cluster_out_id: list[int] = []
    for ci, cluster in enumerate(clusters):
        lon, lat = cluster_centroid[ci]
        oid = len(out_nodes)
        cluster_out_id.append(oid)
        out_nodes.append({"lon": lon, "lat": lat, "is_inter": True, "ci": ci})
        for nid in cluster:
            ktdb_to_out[nid] = oid

    # ── 7. 외부 링크 setback 적용 ─────────────────────────────────────────────
    # setback은 외부 링크(교차로로 진입/진출)에만 적용
    # 교차로 노드 집합 = 클러스터 centroid 노드들
    # 하지만 setback 계산 기준은 원래 ktdb 노드 좌표를 사용
    stop_line_dists = _apply_setbacks(links_raw, node_coord, inter_candidates)

    # ── 8. 외부 링크 JSON 생성 ────────────────────────────────────────────────
    # 내부 링크는 Connection이 되므로 링크 출력에서 제외
    links_json: list[dict] = []
    link_j_to_out: dict[int, int] = {}   # links_raw index → links_json index

    for j, lk in enumerate(links_raw):
        if j in internal_link_idxs:
            continue  # 내부 링크는 Connection으로 처리
        f_out = ktdb_to_out.get(lk["f_node"])
        t_out = ktdb_to_out.get(lk["t_node"])
        if f_out is None or t_out is None:
            continue
        if f_out == t_out:
            continue  # 같은 클러스터 내부로 집계된 링크 (드문 케이스) 제외

        coords = lk["coords"]
        out_j = len(links_json)
        link_j_to_out[j] = out_j
        links_json.append({
            "id"         : out_j,
            "fromNode"   : f_out,
            "toNode"     : t_out,
            "coordinates": coords,
            "lanes"      : [{"id": k, "cells": [], "segments": []}
                             for k in range(lk["lanes"])],
            "numLane"    : lk["lanes"],
            "maxSpd"     : lk["max_spd"],
            "width"      : lk["width"],
            "length"     : round(_link_length(coords), 3),
            "stopLine"   : stop_line_dists.get(j, 0.0),
            "itsLinkId"  : lk["ktdb_id"],
        })

    # ── 9. 출력 노드별 in/out 링크 수집 ─────────────────────────────────────
    node_in_links:  dict[int, list[int]] = defaultdict(list)  # out_node_id → [out_link_idx]
    node_out_links: dict[int, list[int]] = defaultdict(list)

    for out_j, lk_json in enumerate(links_json):
        node_out_links[lk_json["fromNode"]].append(out_j)
        node_in_links[lk_json["toNode"]].append(out_j)

    # ── 10. 교차로 클러스터 Connection 생성 ──────────────────────────────────
    # KTDB 내부 링크는 교차로 클러스터 식별에만 사용하고,
    # Connection은 클러스터에 진입하는 외부 링크 × 진출 외부 링크의 모든 조합으로 생성.
    # 이유: KTDB 내부 링크가 링 구조(A→B→C→D→A)로만 구성되면
    #       내부 링크 기반 매핑은 직진 움직임만 생성되는 문제가 있음.

    # 클러스터별 진입/진출 외부 링크 수집
    # cluster_entry[ci] = {out_link_idx: ...} — 클러스터로 진입하는 고유 외부 링크 목록
    # cluster_exit[ci]  = {out_link_idx: ...} — 클러스터에서 진출하는 고유 외부 링크 목록
    cluster_entry: dict[int, set[int]] = defaultdict(set)
    cluster_exit:  dict[int, set[int]] = defaultdict(set)

    for j, lk in enumerate(links_raw):
        if j in internal_link_idxs:
            continue
        fn, tn = lk["f_node"], lk["t_node"]
        out_j = link_j_to_out.get(j)
        if out_j is None:
            continue
        if tn in node_to_cluster:
            cluster_entry[node_to_cluster[tn]].add(out_j)
        if fn in node_to_cluster:
            cluster_exit[node_to_cluster[fn]].add(out_j)

    # 클러스터 centroid 좌표 (connection 경유점으로 사용)
    cluster_connections: dict[int, list[dict]] = defaultdict(list)

    for ci, cluster in enumerate(clusters):
        clon, clat = cluster_centroid[ci]
        centroid_pt = {"lng": clon, "lat": clat}

        entry_set = cluster_entry.get(ci, set())
        exit_set  = cluster_exit.get(ci, set())

        # TURNINFO 조회용: 클러스터 내 모든 노드의 turninfo 병합
        # (KTDB는 접근 방향별 노드마다 별도 TURNINFO 항목을 가짐)
        node_turns: dict[tuple[str, str], str] = {}
        for nid in cluster:
            node_turns.update(index.turninfo.get(nid, {}))

        conn_id = 0
        for from_out_j in entry_set:
            for to_out_j in exit_set:
                if from_out_j == to_out_j:
                    continue  # 같은 링크 = 해당 링크에서 바로 유턴, 제외

                in_lk  = links_json[from_out_j]
                out_lk = links_json[to_out_j]
                in_coords  = in_lk["coordinates"]
                out_coords = out_lk["coordinates"]

                b_in  = _bearing(in_coords[-2], in_coords[-1])  if len(in_coords)  >= 2 else 0.0
                b_out = _bearing(out_coords[0], out_coords[1]) if len(out_coords) >= 2 else 0.0
                diff  = (b_out - b_in + 360) % 360

                # 유턴(150°~210°) 제외
                if 150.0 <= diff <= 210.0:
                    continue

                # TURNINFO 우선, 없으면 베어링 계산
                in_ktdb  = in_lk["itsLinkId"]
                out_ktdb = out_lk["itsLinkId"]
                if (in_ktdb, out_ktdb) in node_turns:
                    turning = node_turns[(in_ktdb, out_ktdb)]
                else:
                    turning = _turn_direction(b_in, b_out)

                # connection 경로: 진입 링크 끝 → centroid → 진출 링크 시작
                conn_coords: list[dict] = []
                if len(in_coords) >= 1:
                    conn_coords.append(in_coords[-1])
                conn_coords.append(centroid_pt)
                if len(out_coords) >= 1:
                    conn_coords.append(out_coords[0])
                conn_len = round(_link_length(conn_coords), 3) if len(conn_coords) >= 2 else 0.0

                in_lanes  = in_lk["numLane"]
                out_lanes = out_lk["numLane"]
                lane_w = min(in_lk["width"] / max(in_lanes, 1),
                             out_lk["width"] / max(out_lanes, 1))

                for fl, tl in _lane_pairs(turning, in_lanes, out_lanes):
                    cluster_connections[ci].append({
                        "id"         : conn_id,
                        "fromLink"   : from_out_j,
                        "fromLane"   : fl,
                        "toLink"     : to_out_j,
                        "toLane"     : tl,
                        "turning"    : turning,
                        "length"     : conn_len,
                        "width"      : lane_w,
                        "ffSpd"      : min(in_lk["maxSpd"], out_lk["maxSpd"]),
                        "coordinates": conn_coords,
                    })
                    conn_id += 1

    # ── 11. 노드 JSON 생성 ────────────────────────────────────────────────────
    nodes_json: list[dict] = []
    for i, nd in enumerate(out_nodes):
        lon, lat = nd["lon"], nd["lat"]
        in_lnks  = node_in_links.get(i, [])
        out_lnks = node_out_links.get(i, [])
        n_in, n_out = len(in_lnks), len(out_lnks)

        ports: list[dict] = []
        for out_j in in_lnks:
            ports.append({"type": "in",  "linkId": str(out_j)})
        for out_j in out_lnks:
            ports.append({"type": "out", "linkId": str(out_j)})

        if nd["is_inter"]:
            ci = nd["ci"]
            connections = cluster_connections.get(ci, [])
            n_type = _node_type(n_in, n_out, True)
        else:
            # 비교차로: length=0 through-connection
            conn_id = 0
            connections = []
            for in_j in in_lnks:
                for out_j in out_lnks:
                    in_lk  = links_json[in_j]
                    out_lk = links_json[out_j]
                    in_coords  = in_lk["coordinates"]
                    out_coords = out_lk["coordinates"]
                    b_in  = _bearing(in_coords[-2], in_coords[-1])  if len(in_coords)  >= 2 else 0
                    b_out = _bearing(out_coords[0], out_coords[1]) if len(out_coords) >= 2 else 0
                    turning = _turn_direction(b_in, b_out)
                    in_lanes  = in_lk["numLane"]
                    out_lanes = out_lk["numLane"]
                    lane_w = min(in_lk["width"] / in_lanes, out_lk["width"] / out_lanes)
                    # 프론트엔드 렌더링: coordinates가 비어 있으면 lanePositionMap 폴백을
                    # 사용하는데 KTDB 레인은 segment가 없어 해당 맵이 비어 있음 →
                    # in-link 끝점과 out-link 시작점을 명시적으로 제공
                    conn_coords: list[dict] = []
                    if in_coords:
                        conn_coords.append(in_coords[-1])
                    if out_coords:
                        conn_coords.append(out_coords[0])
                    conn_len = round(_link_length(conn_coords), 3) if len(conn_coords) >= 2 else 0.0
                    for fl, tl in _lane_pairs(turning, in_lanes, out_lanes):
                        connections.append({
                            "id"         : conn_id,
                            "fromLink"   : in_j,
                            "fromLane"   : fl,
                            "toLink"     : out_j,
                            "toLane"     : tl,
                            "turning"    : turning,
                            "length"     : conn_len,
                            "width"      : lane_w,
                            "ffSpd"      : min(in_lk["maxSpd"], out_lk["maxSpd"]),
                            "coordinates": conn_coords,
                        })
                        conn_id += 1
            n_type = _node_type(n_in, n_out, False)

        nodes_json.append({
            "id"           : i,
            "type"         : n_type,
            "coordinates"  : {"lat": lat, "lng": lon},
            "numPort"      : len(ports),
            "numConnection": len(connections),
            "ports"        : ports,
            "connections"  : connections,
        })

    return {
        "nodes"    : nodes_json,
        "links"    : links_json,
        "signals"  : [],
        "originLat": (south + north) / 2.0,
        "originLng": (west  + east)  / 2.0,
    }


# ── KTDB → OSM XML 변환 (netconvert 입력용) ───────────────────────────────────

# KTDB ROAD_RANK → OSM highway 태그 매핑
_ROAD_RANK_TO_HIGHWAY = {
    102: "motorway",
    103: "trunk",
    104: "primary",
    105: "secondary",
    106: "tertiary",
    107: "unclassified",
    108: "residential",
}


def ktdb_to_osm_xml(
    index: "KtdbIndex",
    west: float, south: float,
    east: float, north: float,
) -> bytes:
    """
    KTDB bbox → OSM XML bytes.

    netconvert가 교차로 클러스터링/connection을 처리할 수 있도록
    KTDB 노드/링크를 OSM 포맷으로 변환.
    - KTDB 노드 → <node> (실제 노드 ID 사용)
    - KTDB 링크 형상 중간점 → 음수 synthetic <node>
    - KTDB 링크 → <way> (lanes, maxspeed, highway 태그 포함)
    - KTDB는 단방향 → oneway=yes
    """
    link_indices = index.query_links(west, south, east, north)
    if not link_indices:
        return b""

    links_raw = [index.links[i] for i in link_indices]

    # 사용된 노드 ID 수집
    used_node_ids: set[str] = set()
    for lk in links_raw:
        used_node_ids.add(lk["f_node"])
        used_node_ids.add(lk["t_node"])

    lines: list[str] = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<osm version="0.6">',
    ]

    # ── 실제 노드 출력 ────────────────────────────────────────────────────────
    written_nodes: set[str] = set()
    for nid in used_node_ids:
        if nid not in index.nodes:
            continue
        lon, lat = index.nodes[nid]
        lines.append(f'  <node id="{nid}" lat="{lat:.7f}" lon="{lon:.7f}"/>')
        written_nodes.add(nid)

    # ── 링크별 중간점 노드 + way 출력 ─────────────────────────────────────────
    synthetic_id = -1  # 음수 ID로 중간점 노드 구분

    for lk in links_raw:
        coords   = lk["coords"]
        f_node   = lk["f_node"]
        t_node   = lk["t_node"]
        lanes    = lk["lanes"]
        max_spd  = int(lk["max_spd"])
        highway  = _ROAD_RANK_TO_HIGHWAY.get(lk["road_rank"], "tertiary")

        # f_node / t_node 좌표가 없으면 스킵
        if f_node not in written_nodes or t_node not in written_nodes:
            continue

        # 중간점 노드 (첫점·끝점 제외)
        mid_ids: list[str] = []
        for pt in coords[1:-1]:
            lines.append(
                f'  <node id="{synthetic_id}" lat="{pt["lat"]:.7f}" lon="{pt["lng"]:.7f}"/>'
            )
            mid_ids.append(str(synthetic_id))
            synthetic_id -= 1

        # way
        nd_refs = [f_node] + mid_ids + [t_node]
        lines.append(f'  <way id="{lk["ktdb_id"]}">')
        for ref in nd_refs:
            lines.append(f'    <nd ref="{ref}"/>')
        lines.append(f'    <tag k="highway" v="{highway}"/>')
        lines.append(f'    <tag k="lanes" v="{lanes}"/>')
        lines.append(f'    <tag k="maxspeed" v="{max_spd}"/>')
        lines.append(f'    <tag k="oneway" v="yes"/>')
        lines.append(f'    <tag k="name" v="{lk["ktdb_id"]}"/>')
        lines.append( '  </way>')

    lines.append('</osm>')
    return "\n".join(lines).encode("utf-8")



