"""
매핑된 라인 목록 → Network JSON (프론트엔드 NetworkResponse 포맷)

구조:
  {
    "nodes": [ { "id": 0, "coordinates": {"lat", "lng"}, "ports": [], "connections": [] } ],
    "links": [ { "id": 0, "fromNode": 0, "toNode": 1, "coordinates": [...],
                 "lanes": [...], "laneCount": 1, "maxSpd": 50, "width": 7.0 } ]
  }

교차점 탐지:
  - 라인 끝점들을 snap_deg 이내로 클러스터링 → 공유 노드
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from .map_matcher import MatchedLine


SNAP_DEG = 0.00005   # ~5m — 끝점 스냅 거리


@dataclass
class _Node:
    id: int
    lat: float
    lng: float


@dataclass
class _Link:
    id: int
    from_node: int
    to_node: int
    coords: list[dict]    # [{"lat": ..., "lng": ...}]
    lanes: int
    max_spd: int
    width: float


def _snap_point(
    pt: tuple[float, float],
    node_map: dict[int, _Node],
    snap_deg: float,
) -> int | None:
    for nid, nd in node_map.items():
        if math.hypot(pt[0] - nd.lng, pt[1] - nd.lat) <= snap_deg:
            return nid
    return None


def build_network(
    matched_lines: list[MatchedLine],
    origin_lat: float,
    origin_lng: float,
) -> dict[str, Any]:
    """
    MatchedLine 목록 → NetworkResponse 포맷 dict 반환
    """
    node_id_counter = 0
    link_id_counter = 0
    node_map: dict[int, _Node] = {}
    links: list[_Link] = []

    def _get_or_create_node(lon: float, lat: float) -> int:
        nonlocal node_id_counter
        existing = _snap_point((lon, lat), node_map, SNAP_DEG)
        if existing is not None:
            return existing
        nid = node_id_counter
        node_map[nid] = _Node(id=nid, lat=lat, lng=lon)
        node_id_counter += 1
        return nid

    for ml in matched_lines:
        if len(ml.coords) < 2:
            continue

        # 시작/끝 노드
        start_lon, start_lat = ml.coords[0]
        end_lon,   end_lat   = ml.coords[-1]

        from_node = _get_or_create_node(start_lon, start_lat)
        to_node   = _get_or_create_node(end_lon,   end_lat)

        if from_node == to_node:
            continue  # 루프 링크 제외

        coords_list = [{"lat": lat, "lng": lon} for lon, lat in ml.coords]

        link = _Link(
            id        = link_id_counter,
            from_node = from_node,
            to_node   = to_node,
            coords    = coords_list,
            lanes     = ml.lanes,
            max_spd   = float(ml.max_spd),
            width     = ml.width,
        )
        links.append(link)
        link_id_counter += 1

    # JSON 직렬화
    nodes_json = [
        {
            "id"         : nd.id,
            "coordinates": {"lat": nd.lat, "lng": nd.lng},
            "ports"      : [],
            "connections": [],
        }
        for nd in node_map.values()
    ]

    links_json = []
    for lk in links:
        lane_list = [
            {
                "id"      : i,
                "cells"   : [],
                "segments": [],
            }
            for i in range(lk.lanes)
        ]
        links_json.append({
            "id"         : lk.id,
            "fromNode"   : lk.from_node,
            "toNode"     : lk.to_node,
            "coordinates": lk.coords,
            "lanes"      : lane_list,
            "numLane"    : lk.lanes,
            "maxSpd"     : lk.max_spd,
            "width"      : lk.width,
        })

    return {
        "nodes"    : nodes_json,
        "links"    : links_json,
        "originLat": origin_lat,
        "originLng": origin_lng,
    }
