"""
정밀도로지도 SHP → 메모리 인덱스 + bbox 쿼리 → NetworkResponse 포맷 변환

network.xml 교차로 구조 적용:
  - a2_link (linktype=2) 로 연결된 a1_node 묶음 → 교차로 1개 노드 (centroid)
  - 정상 링크의 t_node / f_node 가 교차로 내부이면 해당 교차로 노드로 대체
  - linktype=2 링크 → Connection (fromLink/toLane 등 per-lane)
  - 비교차로 노드 → normal/merging/diverging 타입, length=0 through-connection

레이어 매핑:
  a1_node           → Node
  a2_link (other)   → Link  (lanes=1, 각 a2_link가 차선 하나)
  a2_link (type=2)  → Connection (교차로 내부 경로)
  a2_stop           → 정지선 → link stop_line 거리 계산
  c1_trafficlight   → SignalResponse
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

LINKTYPE_INTERSECTION = "10"   # 교차로내부링크 (intersection internal)


# ── CRS ──────────────────────────────────────────────────────────────────────

def _make_transformer(src) -> Transformer | None:
    try:
        src_crs = ProjCRS.from_wkt(src.crs.to_wkt())
        if src_crs.is_geographic:
            return None
        return Transformer.from_crs(src_crs, 4326, always_xy=True)
    except Exception:
        pass
    return Transformer.from_crs(5179, 4326, always_xy=True)


def _xy(tr: Transformer | None, x: float, y: float) -> tuple[float, float]:
    return tr.transform(x, y) if tr else (x, y)


def _coords_to_wgs(tr: Transformer | None, raw_coords) -> list[dict]:
    return [{"lng": lon, "lat": lat}
            for pt in raw_coords
            for lon, lat in [_xy(tr, pt[0], pt[1])]]


# ── 기하 헬퍼 ─────────────────────────────────────────────────────────────────

def _haversine_m(p1: dict, p2: dict) -> float:
    R = 6_371_000.0
    dlat = math.radians(p2["lat"] - p1["lat"])
    dlon = math.radians(p2["lng"] - p1["lng"])
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(p1["lat"])) * math.cos(math.radians(p2["lat"]))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _bearing(c1: dict, c2: dict) -> float:
    dlon = math.radians(c2["lng"] - c1["lng"])
    rlat1, rlat2 = math.radians(c1["lat"]), math.radians(c2["lat"])
    x = math.sin(dlon) * math.cos(rlat2)
    y = (math.cos(rlat1) * math.sin(rlat2)
         - math.sin(rlat1) * math.cos(rlat2) * math.cos(dlon))
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _turn_direction(in_bearing: float, out_bearing: float) -> str:
    diff = (out_bearing - in_bearing + 360) % 360
    if diff < 45 or diff > 315:
        return "S"
    elif diff <= 180:
        return "R"
    else:
        return "L"


def _link_length(coords: list[dict]) -> float:
    return sum(_haversine_m(coords[k], coords[k + 1])
               for k in range(len(coords) - 1))


# ── SHP 디렉토리 탐색 ────────────────────────────────────────────────────────

def _find_shps(root: str, layer_key: str) -> list[str]:
    """root 하위 모든 폴더에서 *_{layer_key}.shp 파일 수집"""
    result = []
    for entry in os.scandir(root):
        if not entry.is_dir():
            continue
        for f in os.scandir(entry.path):
            if f.name.endswith(f"_{layer_key}.shp"):
                result.append(f.path)
    return result


# ── HdmapIndex ───────────────────────────────────────────────────────────────

class HdmapIndex:
    """시작 시 정밀도로지도 전체를 메모리 로드 + STRtree 인덱스 구축."""

    def __init__(self) -> None:
        self.links: list[dict] = []          # 일반 링크
        self._link_tree: STRtree | None = None

        self.conn_links: list[dict] = []     # linktype=2 (교차로 내부)
        self._conn_tree: STRtree | None = None

        self.nodes: dict[str, tuple[float, float]] = {}   # node_id → (lon, lat)
        self.stoplines: dict[str, dict] = {}               # link_id → {lng, lat, coords}
        self.signals: dict[str, list[dict]] = defaultdict(list)  # link_id → [...]

    @classmethod
    def build(cls, hdmap_root: str) -> "HdmapIndex":
        import fiona
        idx = cls()

        # ── 1. a1_node ────────────────────────────────────────────────────
        log.info("a1_node 로드 중...")
        for shp in _find_shps(hdmap_root, "a1_node"):
            with fiona.open(shp) as src:
                tr = _make_transformer(src)
                for feat in src:
                    props = feat["properties"]
                    nid = str(props.get("id") or "")
                    if not nid:
                        continue
                    try:
                        geom = shape(feat["geometry"])
                        idx.nodes[nid] = _xy(tr, geom.x, geom.y)
                    except Exception:
                        continue
        log.info("  → 노드 %d개", len(idx.nodes))

        # ── 2. a2_link ────────────────────────────────────────────────────
        log.info("a2_link 로드 중...")
        link_mids: list[Point] = []
        conn_mids: list[Point] = []

        for shp in _find_shps(hdmap_root, "a2_link"):
            with fiona.open(shp) as src:
                tr = _make_transformer(src)
                for feat in src:
                    props = feat["properties"]
                    try:
                        geom  = shape(feat["geometry"])
                        mid   = geom.interpolate(0.5, normalized=True)
                        mlon, mlat = _xy(tr, mid.x, mid.y)
                        coords = _coords_to_wgs(tr, geom.coords)

                        entry = {
                            "id"      : str(props.get("id") or ""),
                            "f_node"  : str(props.get("fromnodeid") or ""),
                            "t_node"  : str(props.get("tonodeid")   or ""),
                            "linktype": str(props.get("linktype")    or "6"),
                            "max_spd" : float(props.get("maxspeed")  or 50),
                            "width"   : 3.5,   # 차선 하나 = 3.5m
                            "its_id"  : str(props.get("itslinkid")  or ""),
                            "coords"  : coords,
                            "_mid"    : (mlon, mlat),
                        }

                        if entry["linktype"] == LINKTYPE_INTERSECTION:
                            idx.conn_links.append(entry)
                            conn_mids.append(Point(mlon, mlat))
                        else:
                            idx.links.append(entry)
                            link_mids.append(Point(mlon, mlat))
                    except Exception:
                        continue

        log.info("  → 일반 링크 %d개, 교차로 내부 링크 %d개",
                 len(idx.links), len(idx.conn_links))

        idx._link_tree = STRtree(link_mids)
        idx._conn_tree = STRtree(conn_mids)

        # ── 3. a2_stop ────────────────────────────────────────────────────
        log.info("a2_stop 로드 중...")
        for shp in _find_shps(hdmap_root, "a2_stop"):
            with fiona.open(shp) as src:
                tr = _make_transformer(src)
                for feat in src:
                    props  = feat["properties"]
                    lid    = str(props.get("linkid") or "")
                    if not lid:
                        continue
                    try:
                        geom = shape(feat["geometry"])
                        mid  = geom.interpolate(0.5, normalized=True)
                        lon, lat = _xy(tr, mid.x, mid.y)
                        idx.stoplines[lid] = {
                            "lng"   : lon,
                            "lat"   : lat,
                            "coords": _coords_to_wgs(tr, geom.coords),
                        }
                    except Exception:
                        continue
        log.info("  → 정지선 %d개", len(idx.stoplines))

        # ── 4. c1_trafficlight ────────────────────────────────────────────
        log.info("c1_trafficlight 로드 중...")
        for shp in _find_shps(hdmap_root, "c1_trafficlight"):
            with fiona.open(shp) as src:
                tr = _make_transformer(src)
                for feat in src:
                    props   = feat["properties"]
                    lid     = str(props.get("linkid") or "")
                    if not lid:
                        continue
                    try:
                        geom    = shape(feat["geometry"])
                        lon, lat = _xy(tr, geom.x, geom.y)
                        idx.signals[lid].append({
                            "type"    : str(props.get("type") or "1"),
                            "ref_lane": props.get("ref_lane"),
                            "lng"     : lon,
                            "lat"     : lat,
                        })
                    except Exception:
                        continue
        log.info("  → 신호등 %d개 링크에 매핑", len(idx.signals))

        log.info("HdmapIndex 준비 완료")
        return idx

    def query_bbox(self, west: float, south: float,
                   east: float, north: float) -> tuple[list[int], list[int]]:
        bbox_geom = box(west, south, east, north)

        def _filter(tree, data):
            return [
                int(i) for i in tree.query(bbox_geom)
                if west <= data[i]["_mid"][0] <= east
                and south <= data[i]["_mid"][1] <= north
            ]

        return (_filter(self._link_tree, self.links),
                _filter(self._conn_tree, self.conn_links))


# ── extract_network ───────────────────────────────────────────────────────────

def extract_network(
    index: HdmapIndex,
    west: float, south: float,
    east: float, north: float,
) -> dict[str, Any]:
    """
    bbox 내 HD 맵 데이터 → network.xml 규칙 적용 NetworkResponse dict

    교차로 구성:
      1. linktype=2 링크로 연결된 a1_node들을 연결 성분으로 묶음 → 교차로 클러스터
      2. 클러스터 전체를 centroid 1개 노드로 병합
      3. 일반 링크의 t_node/f_node가 교차로 내부이면 해당 교차로 노드로 대체
      4. linktype=2 링크 → Connection (fromLink/toLink/fromLane/toLane)
      5. 비교차로 노드 → normal/merging/diverging, through-connection (length=0)
    """
    link_idxs, conn_idxs = index.query_bbox(west, south, east, north)
    links_raw = [index.links[i]      for i in link_idxs]
    conns_raw = [index.conn_links[i] for i in conn_idxs]

    if not links_raw and not conns_raw:
        return {"nodes": [], "links": [],
                "originLat": (south + north) / 2,
                "originLng": (west  + east)  / 2}

    # ──────────────────────────────────────────────────────────────────────
    # 1. 교차로 클러스터 식별
    #    linktype=2 링크의 f_node / t_node → "junction 내부 노드"
    #    이 노드들의 연결 성분(connected component) = 하나의 교차로
    # ──────────────────────────────────────────────────────────────────────
    junction_node_ids: set[str] = set()
    for cl in conns_raw:
        junction_node_ids.add(cl["f_node"])
        junction_node_ids.add(cl["t_node"])

    # 인접 그래프 (교차로 내부 노드 간)
    adj: dict[str, set[str]] = defaultdict(set)
    for cl in conns_raw:
        adj[cl["f_node"]].add(cl["t_node"])
        adj[cl["t_node"]].add(cl["f_node"])

    # BFS로 연결 성분 탐색
    visited: set[str] = set()
    clusters: list[set[str]] = []          # 각 원소 = 교차로 1개의 노드 집합
    for start in junction_node_ids:
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
            queue.extend(adj[nid] - visited)
        clusters.append(cluster)

    node_to_cluster: dict[str, int] = {}
    for ci, cluster in enumerate(clusters):
        for nid in cluster:
            node_to_cluster[nid] = ci

    # 교차로 클러스터 centroid 계산
    cluster_coords: list[tuple[float, float] | None] = []
    for cluster in clusters:
        pts = [index.nodes[n] for n in cluster if n in index.nodes]
        if pts:
            cluster_coords.append((
                sum(p[0] for p in pts) / len(pts),
                sum(p[1] for p in pts) / len(pts),
            ))
        else:
            cluster_coords.append(None)

    # ──────────────────────────────────────────────────────────────────────
    # 2. 출력 노드 목록 구성
    #    순서: 비교차로 노드 → 교차로 노드
    # ──────────────────────────────────────────────────────────────────────
    non_junction_ids: set[str] = set()
    for lk in links_raw:
        if lk["f_node"] not in junction_node_ids:
            non_junction_ids.add(lk["f_node"])
        if lk["t_node"] not in junction_node_ids:
            non_junction_ids.add(lk["t_node"])

    # orig_node_id → 출력 정수 ID
    orig_to_out: dict[str, int] = {}

    out_nodes: list[dict] = []   # {"lon","lat","node_type","ci"/-1}

    # 비교차로 노드
    for nid in sorted(non_junction_ids):
        if nid not in index.nodes:
            continue
        lon, lat = index.nodes[nid]
        orig_to_out[nid] = len(out_nodes)
        out_nodes.append({"lon": lon, "lat": lat, "node_type": "regular", "ci": -1})

    # 교차로 노드 (클러스터당 1개)
    cluster_out_id: list[int | None] = []
    for ci, coords in enumerate(cluster_coords):
        if coords is None:
            cluster_out_id.append(None)
            continue
        lon, lat = coords
        oid = len(out_nodes)
        cluster_out_id.append(oid)
        out_nodes.append({"lon": lon, "lat": lat, "node_type": "intersection", "ci": ci})
        # 클러스터 내 모든 노드 → 같은 출력 ID
        for nid in clusters[ci]:
            orig_to_out[nid] = oid

    def resolve_node(nid: str) -> int | None:
        return orig_to_out.get(nid)

    # ──────────────────────────────────────────────────────────────────────
    # 3. 링크 생성
    #    정지선이 있으면 t_node 쪽 끝점을 정지선 위치로 교체
    #    stop_line 거리 = 교차로 centroid → 정지선 중점
    # ──────────────────────────────────────────────────────────────────────
    links_out: list[dict] = []
    valid_links_raw: list[dict] = []        # links_out 과 1:1 대응

    # junction 내부 노드 → 연결된 출력 링크 인덱스 맵핑 (for connection 빌드)
    j_node_in_link:  dict[str, int] = {}   # junction_node_id → link_j (해당 노드로 들어오는 링크)
    j_node_out_link: dict[str, int] = {}   # junction_node_id → link_j (해당 노드에서 나가는 링크)

    for lk in links_raw:
        f_int = resolve_node(lk["f_node"])
        t_int = resolve_node(lk["t_node"])
        if f_int is None or t_int is None:
            continue

        coords = list(lk["coords"])
        stop_line_m = 0.0

        # 정지선 처리: t_node 가 교차로 내부이면 링크 끝점을 정지선 위치로 조정
        if lk["t_node"] in junction_node_ids:
            stop = index.stoplines.get(lk["id"])
            if stop and coords:
                coords[-1] = {"lng": stop["lng"], "lat": stop["lat"]}
                ci = node_to_cluster[lk["t_node"]]
                cc = cluster_coords[ci]
                if cc:
                    stop_line_m = round(
                        _haversine_m({"lng": cc[0], "lat": cc[1]},
                                     {"lng": stop["lng"], "lat": stop["lat"]}), 3)

        j = len(links_out)
        link_len = round(_link_length(coords), 3)

        links_out.append({
            "id"         : j,
            "fromNode"   : f_int,
            "toNode"     : t_int,
            "coordinates": coords,
            "lanes"      : [{"id": 0, "cells": [], "segments": []}],
            "numLane"    : 1,
            "maxSpd"     : lk["max_spd"],
            "width"      : lk["width"],
            "length"     : link_len,
            "stopLine"   : stop_line_m,
            "itsLinkId"  : lk["its_id"],
        })
        valid_links_raw.append(lk)

        # junction 노드와의 연결 기록
        if lk["t_node"] in junction_node_ids:
            j_node_in_link[lk["t_node"]] = j    # 이 링크가 junction으로 들어감
        if lk["f_node"] in junction_node_ids:
            j_node_out_link[lk["f_node"]] = j   # 이 링크가 junction에서 나감

    # ──────────────────────────────────────────────────────────────────────
    # 4. 출력 노드별 in/out 링크 수집
    # ──────────────────────────────────────────────────────────────────────
    node_in_links:  dict[int, list[int]] = defaultdict(list)
    node_out_links: dict[int, list[int]] = defaultdict(list)

    for j, lk_json in enumerate(links_out):
        node_out_links[lk_json["fromNode"]].append(j)
        node_in_links[lk_json["toNode"]].append(j)

    # ──────────────────────────────────────────────────────────────────────
    # 5. 교차로 Connection 생성
    #    linktype=2 링크 하나 = 차선 1개의 교차로 내부 경로
    #    → from_link / from_lane=0 / to_link / to_lane=0
    # ──────────────────────────────────────────────────────────────────────
    cluster_connections: dict[int, list[dict]] = defaultdict(list)
    cluster_conn_counter: dict[int, int] = defaultdict(int)

    for cl in conns_raw:
        f_nid = cl["f_node"]   # 교차로 진입 노드 (일반 링크의 t_node)
        t_nid = cl["t_node"]   # 교차로 진출 노드 (일반 링크의 f_node)

        ci = node_to_cluster.get(f_nid)
        if ci is None:
            continue

        out_node_id = cluster_out_id[ci]
        if out_node_id is None:
            continue

        from_link_j = j_node_in_link.get(f_nid)
        to_link_j   = j_node_out_link.get(t_nid)
        if from_link_j is None or to_link_j is None:
            continue

        conn_coords = cl["coords"]

        # 회전 방향
        if len(conn_coords) >= 2:
            b_in  = _bearing(conn_coords[0],  conn_coords[1])
            b_out = _bearing(conn_coords[-2], conn_coords[-1])
            turning = _turn_direction(b_in, b_out)
        else:
            turning = "S"

        conn_len = round(_link_length(conn_coords), 3)

        # 신호 정보
        signals = (index.signals.get(cl["id"])
                   or index.signals.get(valid_links_raw[from_link_j]["id"])
                   or [])

        conn_id = cluster_conn_counter[ci]
        cluster_connections[ci].append({
            "id"         : conn_id,
            "fromLink"   : from_link_j,
            "fromLane"   : 0,
            "toLink"     : to_link_j,
            "toLane"     : 0,
            "turning"    : turning,
            "length"     : conn_len,
            "width"      : cl["width"],
            "ffSpd"      : cl["max_spd"],
            "coordinates": conn_coords,
            "_signals"   : signals,
        })
        cluster_conn_counter[ci] += 1

    # ──────────────────────────────────────────────────────────────────────
    # 6. 노드 JSON 생성
    # ──────────────────────────────────────────────────────────────────────
    nodes_out: list[dict] = []
    signals_out: list[dict] = []

    for i, nd in enumerate(out_nodes):
        lon = nd["lon"]
        lat = nd["lat"]
        in_lnks  = node_in_links.get(i, [])
        out_lnks = node_out_links.get(i, [])
        n_in, n_out = len(in_lnks), len(out_lnks)

        ports: list[dict] = []
        for j in in_lnks:
            ports.append({"type": "in",  "linkId": str(j)})
        for j in out_lnks:
            ports.append({"type": "out", "linkId": str(j)})

        if nd["node_type"] == "intersection":
            ci = nd["ci"]
            connections = cluster_connections.get(ci, [])

            # 노드 타입 판별
            if n_in >= 2 and n_out >= 2:
                n_type = "intersection"
            elif n_in > n_out:
                n_type = "merging"
            elif n_out > n_in:
                n_type = "diverging"
            else:
                n_type = "intersection"

        else:
            # 비교차로 노드: through-connection (length=0)
            if n_in > 1 and n_out > 1:
                n_type = "intersection"
            elif n_in > n_out:
                n_type = "merging"
            elif n_out > n_in:
                n_type = "diverging"
            else:
                n_type = "normal"

            conn_counter = 0
            connections = []
            for in_j in in_lnks:
                for out_j in out_lnks:
                    connections.append({
                        "id"         : conn_counter,
                        "fromLink"   : in_j,
                        "fromLane"   : 0,
                        "toLink"     : out_j,
                        "toLane"     : 0,
                        "turning"    : "S",
                        "length"     : 0,
                        "width"      : links_out[in_j]["width"],
                        "ffSpd"      : links_out[in_j]["maxSpd"],
                        "coordinates": [],
                    })
                    conn_counter += 1

        # 신호 추출: from_link의 원본 link ID가 signals dict에 있으면 SignalResponse 생성
        for conn in connections:
            from_link_j = conn["fromLink"]
            orig_link_id = valid_links_raw[from_link_j]["id"] if from_link_j < len(valid_links_raw) else ""
            sigs = (conn.pop("_signals", None)
                    or index.signals.get(orig_link_id)
                    or [])
            for sig in sigs:
                signals_out.append({
                    "nodeId"      : str(i),
                    "connectionId": str(conn["id"]),
                    "turning"     : conn["turning"],
                    "type"        : sig.get("type", "1"),
                })

        nodes_out.append({
            "id"           : i,
            "type"         : n_type,
            "coordinates"  : {"lat": lat, "lng": lon},
            "numPort"      : len(ports),
            "numConnection": len(connections),
            "ports"        : ports,
            "connections"  : connections,
        })

    return {
        "nodes"    : nodes_out,
        "links"    : links_out,
        "signals"  : signals_out,
        "originLat": (south + north) / 2.0,
        "originLng": (west  + east)  / 2.0,
    }
