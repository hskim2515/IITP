"""
도로 마스크(bool) → 중심선 GeoJSON LineString 목록

1. skimage.morphology.skeletonize → 1px 중심선
2. 교차점/끝점 검출 → 그래프 노드
3. DFS로 세그먼트 추적 → polyline
4. 픽셀 좌표 → 경위도 변환
"""
from __future__ import annotations

from collections import defaultdict, deque
from typing import Generator

import numpy as np
from skimage import morphology


# ── 내부 유틸 ────────────────────────────────────────────────────────────────

def _neighbors8(y: int, x: int, h: int, w: int) -> Generator[tuple[int, int], None, None]:
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0:
                continue
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w:
                yield ny, nx


def _skeleton_to_graph(skel: np.ndarray) -> dict[tuple, list[tuple]]:
    """스켈레톤 배열 → {픽셀: 인접픽셀 리스트} 인접 그래프"""
    h, w = skel.shape
    ys, xs = np.where(skel)
    px_set = set(zip(ys.tolist(), xs.tolist()))

    graph: dict[tuple, list] = defaultdict(list)
    for y, x in px_set:
        for ny, nx in _neighbors8(y, x, h, w):
            if (ny, nx) in px_set:
                graph[(y, x)].append((ny, nx))
    return dict(graph)


def _is_junction_or_endpoint(node: tuple, graph: dict) -> bool:
    deg = len(graph.get(node, []))
    return deg != 2


def _trace_segments(graph: dict) -> list[list[tuple]]:
    """그래프에서 교차점/끝점 사이의 polyline 세그먼트 추출"""
    visited_edges: set[tuple] = set()
    segments: list[list[tuple]] = []

    # 교차점/끝점 우선 탐색 시작
    junctions = [n for n in graph if _is_junction_or_endpoint(n, graph)]
    start_nodes = junctions if junctions else list(graph.keys())[:1]

    def _walk(start: tuple, nxt: tuple) -> list[tuple]:
        path = [start, nxt]
        prev = start
        cur  = nxt
        while True:
            key = (min(prev, cur), max(prev, cur))
            visited_edges.add(key)
            if _is_junction_or_endpoint(cur, graph):
                break
            nbs = [n for n in graph.get(cur, []) if n != prev]
            if not nbs:
                break
            new_next = nbs[0]
            edge_key = (min(cur, new_next), max(cur, new_next))
            if edge_key in visited_edges:
                break
            prev, cur = cur, new_next
            path.append(cur)
        return path

    for s in start_nodes:
        for nb in graph.get(s, []):
            key = (min(s, nb), max(s, nb))
            if key not in visited_edges:
                visited_edges.add(key)
                seg = _walk(s, nb)
                if len(seg) >= 2:
                    segments.append(seg)

    # 고립된 사이클 처리 (교차점 없는 순환 도로)
    for node in list(graph.keys()):
        if all(
            (min(node, nb), max(node, nb)) in visited_edges
            for nb in graph.get(node, [])
        ):
            continue
        # 미방문 엣지 존재
        for nb in graph.get(node, []):
            key = (min(node, nb), max(node, nb))
            if key not in visited_edges:
                seg = _walk(node, nb)
                if len(seg) >= 2:
                    segments.append(seg)

    return segments


def _simplify_segment(seg: list[tuple], tolerance: float = 1.5) -> list[tuple]:
    """Ramer-Douglas-Peucker 단순화 (픽셀 단위)"""
    if len(seg) <= 2:
        return seg
    pts = [(x, y) for y, x in seg]
    return [(y, x) for x, y in _rdp(pts, tolerance)]


def _rdp(pts: list[tuple], eps: float) -> list[tuple]:
    if len(pts) <= 2:
        return pts
    start, end = pts[0], pts[-1]
    max_dist = 0.0
    max_idx  = 0
    for i in range(1, len(pts) - 1):
        d = _point_line_dist(pts[i], start, end)
        if d > max_dist:
            max_dist = d
            max_idx  = i
    if max_dist > eps:
        left  = _rdp(pts[:max_idx + 1], eps)
        right = _rdp(pts[max_idx:],      eps)
        return left[:-1] + right
    return [start, end]


def _point_line_dist(p: tuple, a: tuple, b: tuple) -> float:
    ax, ay = a; bx, by = b; px, py = p
    if ax == bx and ay == by:
        return math.hypot(px - ax, py - ay)
    dx, dy = bx - ax, by - ay
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)


import math

# ── 공개 함수 ────────────────────────────────────────────────────────────────

def skeletonize_mask(mask: np.ndarray) -> np.ndarray:
    """도로 마스크 → 1px 스켈레톤"""
    return morphology.skeletonize(mask)


def skeleton_to_lines(
    skel: np.ndarray,
    px_to_lonlat,
    min_segment_px: int = 10,
    rdp_tolerance: float = 1.5,
) -> list[list[tuple[float, float]]]:
    """
    스켈레톤 배열 → 경위도 좌표 LineString 목록

    Parameters
    ----------
    skel            : (H, W) bool 스켈레톤
    px_to_lonlat    : callable(px, py) → (lon, lat)
    min_segment_px  : 최소 세그먼트 픽셀 수 (짧은 선 제거)
    rdp_tolerance   : RDP 단순화 픽셀 허용 오차

    Returns
    -------
    list of [[lon, lat], ...]
    """
    graph = _skeleton_to_graph(skel)
    if not graph:
        return []

    segments = _trace_segments(graph)

    lines = []
    for seg in segments:
        if len(seg) < min_segment_px:
            continue
        simplified = _simplify_segment(seg, rdp_tolerance)
        coords = []
        for py, px in simplified:
            lon, lat = px_to_lonlat(px, py)
            coords.append((lon, lat))
        if len(coords) >= 2:
            lines.append(coords)

    return lines
