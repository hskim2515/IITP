"""
위성 추출 라인 ↔ 전국 노드링크 SHP 매핑

KTDB 노드링크 SHP에서:
  - 노드 레이어: NODE_ID, X_COORD, Y_COORD (EPSG:5179)
  - 링크 레이어: LINK_ID, F_NODE, T_NODE, LANES, MAX_SPD, WIDTH, ...

매핑 전략:
  1. 위성 라인의 각 포인트를 KTDB 링크에 스냅
  2. 스냅 거리 임계값 이내 + 방향 유사성 점수 > 임계값이면 매핑
  3. 매핑된 KTDB 링크의 속성(차선수, 제한속도 등) 사용
  4. 매핑 안 된 위성 라인은 기본값으로 생성
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree


# EPSG:5179 (국가좌표) → EPSG:4326 (WGS84)
_TRANSFORMER_5179_TO_4326 = Transformer.from_crs(5179, 4326, always_xy=True)


@dataclass
class KtdbLink:
    link_id: str
    f_node: str
    t_node: str
    lanes: int
    max_spd: int
    width: float
    geometry: LineString          # WGS84
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass
class MatchedLine:
    coords: list[tuple[float, float]]   # [[lon, lat], ...]
    lanes: int
    max_spd: int
    width: float
    ktdb_link_id: str | None = None


def load_ktdb_shp(node_shp_path: str, link_shp_path: str) -> list[KtdbLink]:
    """KTDB SHP 파일 로드 → KtdbLink 목록"""
    try:
        import fiona
        from shapely.geometry import shape
    except ImportError:
        raise ImportError("fiona, shapely 필요: pip install fiona shapely")

    # 링크 레이어
    links: list[KtdbLink] = []
    with fiona.open(link_shp_path, "r") as src:
        for feat in src:
            props = feat["properties"]
            try:
                geom_raw = shape(feat["geometry"])
                # EPSG:5179 → WGS84
                coords_4326 = [
                    _TRANSFORMER_5179_TO_4326.transform(x, y)
                    for x, y in geom_raw.coords
                ]
                geom_4326 = LineString(coords_4326)
                links.append(KtdbLink(
                    link_id = str(props.get("LINK_ID", "")),
                    f_node  = str(props.get("F_NODE", "")),
                    t_node  = str(props.get("T_NODE", "")),
                    lanes   = int(props.get("LANES", 1) or 1),
                    max_spd = int(props.get("MAX_SPD", 50) or 50),
                    width   = float(props.get("WIDTH", 7.0) or 7.0),
                    geometry= geom_4326,
                    raw     = dict(props),
                ))
            except Exception:
                continue
    return links


def match_lines(
    sat_lines: list[list[tuple[float, float]]],
    ktdb_links: list[KtdbLink] | None,
    snap_dist_deg: float = 0.0002,   # ~22m
    direction_threshold: float = 0.6,
) -> list[MatchedLine]:
    """
    위성 추출 라인과 KTDB 링크 매핑.
    ktdb_links가 None이면 기본값으로만 MatchedLine 생성.
    """
    if not ktdb_links:
        return [
            MatchedLine(coords=line, lanes=1, max_spd=50, width=7.0)
            for line in sat_lines
        ]

    # STRtree 공간 인덱스 구성
    geoms  = [lnk.geometry for lnk in ktdb_links]
    tree   = STRtree(geoms)

    matched: list[MatchedLine] = []
    for sat_line in sat_lines:
        if len(sat_line) < 2:
            continue
        ls = LineString(sat_line)
        mid_pt = ls.interpolate(0.5, normalized=True)

        candidate_idxs = tree.query(mid_pt.buffer(snap_dist_deg * 5))
        best_link: KtdbLink | None = None
        best_score = -1.0

        # 위성 라인 방향 벡터
        sat_dir = _line_direction(sat_line)

        for idx in candidate_idxs:
            lnk = ktdb_links[idx]
            dist = mid_pt.distance(lnk.geometry)
            if dist > snap_dist_deg * 5:
                continue

            # 방향 유사도 (코사인)
            lnk_dir = _line_direction(list(lnk.geometry.coords))
            cos_sim = abs(_cosine(sat_dir, lnk_dir))

            score = cos_sim * (1.0 - dist / (snap_dist_deg * 5))
            if score > best_score and cos_sim > direction_threshold:
                best_score = score
                best_link  = lnk

        if best_link:
            matched.append(MatchedLine(
                coords      = sat_line,
                lanes       = best_link.lanes,
                max_spd     = best_link.max_spd,
                width       = best_link.width,
                ktdb_link_id= best_link.link_id,
            ))
        else:
            matched.append(MatchedLine(
                coords  = sat_line,
                lanes   = 1,
                max_spd = 50,
                width   = 7.0,
            ))

    return matched


def _line_direction(coords: list[tuple]) -> tuple[float, float]:
    if len(coords) < 2:
        return (1.0, 0.0)
    x1, y1 = coords[0]
    x2, y2 = coords[-1]
    dx, dy = x2 - x1, y2 - y1
    mag = math.hypot(dx, dy) or 1e-9
    return dx / mag, dy / mag


def _cosine(a: tuple[float, float], b: tuple[float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1]
