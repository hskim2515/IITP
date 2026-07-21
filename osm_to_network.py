#!/usr/bin/env python3
"""
OSM → network.xml 변환 도구 (IITP 교통 시뮬레이션)

Dependencies:
    pip install osmnx shapely

Usage:
    python osm_to_network.py --place "강남구, 서울" -o network.xml
    python osm_to_network.py --bbox 37.49 127.02 37.52 127.06 -o network.xml
    python osm_to_network.py --osm input.osm -o network.xml

Notes:
    - 좌표계: local x/y (m) = (lon-baseLon)*88000, (lat-baseLat)*111000
    - 차선별 connection은 휴리스틱으로 생성됨 → 수동 보정 권장
    - 교통류 파라미터(wave_spd, qmax 등)는 도로 유형별 기본값 사용
    - CTM 셀 길이 기준: 69.44m (50km/h × 5s 시뮬레이션 스텝 기준)
"""

import argparse
import math
import sys
from typing import Dict, List, Optional, Tuple
from xml.dom import minidom
import xml.etree.ElementTree as ET

try:
    import osmnx as ox
except ImportError:
    print("osmnx가 설치되지 않았습니다. 다음 명령으로 설치하세요:", file=sys.stderr)
    print("  pip install osmnx", file=sys.stderr)
    sys.exit(1)

# ─── 시뮬레이션 상수 ─────────────────────────────────────────────────────────
SCALE_X = 88000.0    # lon → m (위도 37° 기준 근사값)
SCALE_Y = 111000.0   # lat → m
BASE_CELL_LEN = 69.44   # CTM 셀 길이 (m) = 50km/h × 5s
JAM_DENSITY = 150.0  # 차량 밀도 (veh/km/lane)

# ─── 도로 유형별 기본값 ──────────────────────────────────────────────────────
ROAD_DEFAULTS: Dict[str, dict] = {
    'motorway':       {'max_spd': 100.0, 'ff_spd': 100.0, 'wave_spd': 6.00, 'qmax': 2400.0, 'lanes': 3, 'lane_w': 3.5},
    'motorway_link':  {'max_spd':  60.0, 'ff_spd':  60.0, 'wave_spd': 5.00, 'qmax': 1800.0, 'lanes': 1, 'lane_w': 3.5},
    'trunk':          {'max_spd':  80.0, 'ff_spd':  80.0, 'wave_spd': 5.50, 'qmax': 2200.0, 'lanes': 2, 'lane_w': 3.5},
    'trunk_link':     {'max_spd':  60.0, 'ff_spd':  60.0, 'wave_spd': 5.00, 'qmax': 1800.0, 'lanes': 1, 'lane_w': 3.5},
    'primary':        {'max_spd':  60.0, 'ff_spd':  60.0, 'wave_spd': 4.95, 'qmax': 1800.0, 'lanes': 2, 'lane_w': 3.5},
    'primary_link':   {'max_spd':  50.0, 'ff_spd':  50.0, 'wave_spd': 4.00, 'qmax': 1800.0, 'lanes': 1, 'lane_w': 3.5},
    'secondary':      {'max_spd':  50.0, 'ff_spd':  50.0, 'wave_spd': 3.62, 'qmax': 1800.0, 'lanes': 2, 'lane_w': 3.5},
    'secondary_link': {'max_spd':  40.0, 'ff_spd':  40.0, 'wave_spd': 3.19, 'qmax': 1800.0, 'lanes': 1, 'lane_w': 3.5},
    'tertiary':       {'max_spd':  40.0, 'ff_spd':  40.0, 'wave_spd': 3.00, 'qmax': 1800.0, 'lanes': 1, 'lane_w': 3.5},
    'tertiary_link':  {'max_spd':  30.0, 'ff_spd':  30.0, 'wave_spd': 2.50, 'qmax':  900.0, 'lanes': 1, 'lane_w': 3.0},
    'residential':    {'max_spd':  30.0, 'ff_spd':  30.0, 'wave_spd': 2.36, 'qmax':  900.0, 'lanes': 1, 'lane_w': 3.0},
    'living_street':  {'max_spd':  20.0, 'ff_spd':  20.0, 'wave_spd': 2.00, 'qmax':  600.0, 'lanes': 1, 'lane_w': 3.0},
    'unclassified':   {'max_spd':  30.0, 'ff_spd':  30.0, 'wave_spd': 2.36, 'qmax':  900.0, 'lanes': 1, 'lane_w': 3.0},
    'service':        {'max_spd':  20.0, 'ff_spd':  20.0, 'wave_spd': 2.00, 'qmax':  600.0, 'lanes': 1, 'lane_w': 3.0},
    '_default':       {'max_spd':  30.0, 'ff_spd':  30.0, 'wave_spd': 2.36, 'qmax':  900.0, 'lanes': 1, 'lane_w': 3.5},
}


# ─── 좌표 변환 ───────────────────────────────────────────────────────────────

def ll_to_local(lat: float, lon: float, base_lat: float, base_lon: float) -> Tuple[float, float]:
    """WGS84 위경도 → 로컬 좌표(m)"""
    x = (lon - base_lon) * SCALE_X
    y = (lat - base_lat) * SCALE_Y
    return x, y


def local_to_ll(x: float, y: float, base_lat: float, base_lon: float) -> Tuple[float, float]:
    """로컬 좌표(m) → WGS84 위경도 (검증용)"""
    lon = base_lon + x / SCALE_X
    lat = base_lat + y / SCALE_Y
    return lat, lon


# ─── 기하 유틸 ───────────────────────────────────────────────────────────────

def bearing(x1: float, y1: float, x2: float, y2: float) -> float:
    """두 로컬 좌표 간의 방위각 (degree, 북=0, 시계 방향)"""
    return math.degrees(math.atan2(x2 - x1, y2 - y1))


def angle_diff(a_in: float, a_out: float) -> float:
    """입력→출력 방향 전환 각도 (degree, -180~180)"""
    return (a_out - a_in + 180) % 360 - 180


def classify_turn(deg: float) -> str:
    """각도 차이 → 회전방향 (L/S/R)"""
    if deg < -45:
        return 'L'
    if deg > 45:
        return 'R'
    return 'S'


def polyline_length(coords: List[Tuple[float, float]]) -> float:
    """폴리라인 총 길이 (m)"""
    total = 0.0
    for i in range(len(coords) - 1):
        dx = coords[i + 1][0] - coords[i][0]
        dy = coords[i + 1][1] - coords[i][1]
        total += math.sqrt(dx * dx + dy * dy)
    return total


# ─── OSM 속성 파서 ──────────────────────────────────────────────────────────

def _first(val):
    """리스트인 경우 첫 번째 값, 아니면 그대로"""
    return val[0] if isinstance(val, list) else val


def road_defaults(highway) -> dict:
    hw = _first(highway) if highway else '_default'
    return ROAD_DEFAULTS.get(hw, ROAD_DEFAULTS['_default'])


def parse_lanes(lanes_attr, highway) -> int:
    try:
        return max(1, int(_first(lanes_attr)))
    except (TypeError, ValueError):
        return road_defaults(highway)['lanes']


def parse_maxspeed(maxspeed_attr, highway) -> float:
    """maxspeed 태그 파싱 (km/h)"""
    try:
        val = str(_first(maxspeed_attr)).strip()
        # 한국 표준 태그
        _kr = {'KR:urban': 50.0, 'KR:rural': 80.0, 'KR:motorway': 110.0}
        if val in _kr:
            return _kr[val]
        val = val.replace('km/h', '').replace('kmh', '').replace('mph', '').strip()
        return float(val)
    except (TypeError, ValueError, AttributeError):
        return road_defaults(highway)['max_spd']


# ─── 차선 연결 휴리스틱 ─────────────────────────────────────────────────────

def assign_lane_pairs(
    in_lanes: int,
    out_lanes: int,
    turning: str,
) -> List[Tuple[int, int]]:
    """
    회전 방향에 따른 (from_lane, to_lane) 쌍 생성.

    차선 번호 규칙 (network.xml 기준):
      0 = 좌측 차선, n-1 = 우측 차선

    휴리스틱:
      L  → 좌측 1~2개 차선이 좌회전
      R  → 우측 1~2개 차선이 우회전
      S  → 가운데 차선들이 직진 (1차로면 모두 직진)
    """
    pairs: List[Tuple[int, int]] = []

    if turning == 'L':
        n = 1 if in_lanes <= 3 else 2
        for i in range(n):
            pairs.append((i, min(i, out_lanes - 1)))

    elif turning == 'R':
        n = 1 if in_lanes <= 3 else 2
        for i in range(n):
            from_l = in_lanes - 1 - i
            to_l = out_lanes - 1 - i
            pairs.append((from_l, max(0, to_l)))

    else:  # Straight
        if in_lanes == 1:
            pairs.append((0, 0))
        elif in_lanes == 2:
            pairs.append((0, min(0, out_lanes - 1)))
            pairs.append((1, min(1, out_lanes - 1)))
        else:
            # 좌측 1개, 우측 1개 제외한 중간 차선
            start = 1
            end = in_lanes - 1
            for idx, from_l in enumerate(range(start, end)):
                to_l = min(idx, out_lanes - 1)
                pairs.append((from_l, to_l))
            if not pairs:
                pairs.append((in_lanes // 2, min(out_lanes // 2, out_lanes - 1)))

    # 중복 제거
    return list(dict.fromkeys(pairs))


# ─── CTM 파라미터 계산 ──────────────────────────────────────────────────────

def calc_num_cells(length: float) -> int:
    """링크 길이 → CTM 셀 수 (기준: 69.44m/cell)"""
    return max(1, math.ceil(length / BASE_CELL_LEN))


def calc_max_veh(length: float, num_lanes: int) -> float:
    """최대 수용 차량 수 = length(km) × jam_density × lanes"""
    return round(length / 1000.0 * JAM_DENSITY * num_lanes, 2)


def calc_wave_spd(qmax: float, jam_density_per_lane: float = JAM_DENSITY, ff_spd: float = 50.0) -> float:
    """
    LWR 모델 충격파 속도 = qmax / (jam_density - qmax/ff_spd)
    도로 유형 기본값 사용 권장
    """
    try:
        cap_density = qmax / ff_spd * (1000.0 / 3600.0)  # veh/m
        w = qmax / (jam_density_per_lane / 1000.0 - cap_density)
        return round(abs(w) * 3600 / 1000, 2)  # km/h
    except ZeroDivisionError:
        return 2.36


# ─── 링크 베어링 계산 ───────────────────────────────────────────────────────

def link_start_bearing(coords: List[Tuple[float, float]]) -> float:
    """링크 출발부 방위각 (첫 두 점 기준)"""
    if len(coords) < 2:
        return 0.0
    return bearing(coords[0][0], coords[0][1], coords[1][0], coords[1][1])


def link_end_bearing(coords: List[Tuple[float, float]]) -> float:
    """링크 도착부 방위각 (마지막 두 점 기준)"""
    if len(coords) < 2:
        return 0.0
    return bearing(coords[-2][0], coords[-2][1], coords[-1][0], coords[-1][1])


# ─── 교차로 connection 길이 추정 ────────────────────────────────────────────

def estimate_conn_length(in_coords, out_coords, turning: str, node_xy: Tuple[float, float]) -> float:
    """
    교차로 내부 주행 거리 추정.
    입출구 폭과 회전 방향에 따라 근사값 반환 (m).
    """
    # 교차로 중심에서 입출구 끝까지의 거리
    nx, ny = node_xy
    d_in = math.sqrt((in_coords[-1][0] - nx) ** 2 + (in_coords[-1][1] - ny) ** 2)
    d_out = math.sqrt((out_coords[0][0] - nx) ** 2 + (out_coords[0][1] - ny) ** 2)
    base = max(10.0, d_in + d_out)

    if turning == 'S':
        return round(base, 2)
    elif turning == 'L':
        # 좌회전: 교차로 대각 통과 → 직진보다 길다
        return round(base * 1.2, 2)
    else:  # R
        # 우회전: 모서리 반경 통과 → 직진보다 짧다
        return round(base * 0.7, 2)


# ─── 메인 변환 함수 ─────────────────────────────────────────────────────────

def build_network_xml(G, base_lat: float, base_lon: float, network_id: int = 0) -> ET.Element:
    """
    osmnx MultiDiGraph → NetworkXml 구조의 ET.Element 반환
    """

    # ── ID 할당 ──────────────────────────────────────────────────────────────
    # 노드 degree 계산 (무방향 기준)
    undirected_degree: Dict = {}
    for u, v, _ in G.edges(keys=True):
        undirected_degree[u] = undirected_degree.get(u, 0) + 1
        undirected_degree[v] = undirected_degree.get(v, 0) + 1

    terminal_nodes = {n for n in G.nodes() if undirected_degree.get(n, 0) <= 1}

    node_id_map: Dict = {}  # osm_id → our_id
    int_counter = 10000001
    term_counter = 11000001
    for n in G.nodes():
        if n in terminal_nodes:
            node_id_map[n] = term_counter
            term_counter += 1
        else:
            node_id_map[n] = int_counter
            int_counter += 1

    link_id_map: Dict = {}  # (u,v,k) → our_id
    link_counter = 20000001
    for u, v, k in G.edges(keys=True):
        link_id_map[(u, v, k)] = link_counter
        link_counter += 1

    # ── 노드별 in/out link 목록 ──────────────────────────────────────────────
    in_links: Dict[int, List] = {}   # osm_node → [(lid, u, v, k), ...]
    out_links: Dict[int, List] = {}
    for u, v, k in G.edges(keys=True):
        lid = link_id_map[(u, v, k)]
        out_links.setdefault(u, []).append((lid, u, v, k))
        in_links.setdefault(v, []).append((lid, u, v, k))

    # ── 노드 로컬 좌표 ───────────────────────────────────────────────────────
    node_local: Dict = {}  # osm_id → (x, y)
    for n, d in G.nodes(data=True):
        node_local[n] = ll_to_local(d['y'], d['x'], base_lat, base_lon)

    # ── 링크 shape (로컬 좌표) ───────────────────────────────────────────────
    link_shape: Dict = {}  # (u,v,k) → [(x,y), ...]
    for u, v, k, d in G.edges(keys=True, data=True):
        if 'geometry' in d:
            coords = [(ll_to_local(lat, lon, base_lat, base_lon))
                      for lon, lat in d['geometry'].coords]
        else:
            coords = [node_local[u], node_local[v]]
        link_shape[(u, v, k)] = coords

    # ── 링크 길이 ─────────────────────────────────────────────────────────────
    link_len: Dict = {}
    for edge, coords in link_shape.items():
        link_len[edge] = polyline_length(coords)

    # ════════════════════════════════════════════════════════════════════════
    # XML 트리 생성
    # ════════════════════════════════════════════════════════════════════════
    root = ET.Element('Network', id=str(network_id))
    nodes_elem = ET.SubElement(root, 'nodes')
    links_elem = ET.SubElement(root, 'links')

    # ── NODES ─────────────────────────────────────────────────────────────
    for osm_n in sorted(G.nodes()):
        our_id = node_id_map[osm_n]
        lx, ly = node_local[osm_n]

        ins = in_links.get(osm_n, [])
        outs = out_links.get(osm_n, [])
        num_port = len(ins) + len(outs)

        # 노드 유형 결정
        if osm_n in terminal_nodes:
            ntype = 'terminal'
        elif len(ins) == 1 and len(outs) == 1:
            ntype = 'normal'
        elif len(ins) > len(outs):
            ntype = 'merging'
        elif len(outs) > len(ins):
            ntype = 'diverging'
        else:
            ntype = 'intersection'

        # ── Connection 생성 ───────────────────────────────────────────────
        connections = []
        conn_id = 0

        for in_lid, in_u, in_v, in_k in ins:
            in_data = G[in_u][in_v][in_k]
            in_hw = in_data.get('highway', '_default')
            in_nlanes = parse_lanes(in_data.get('lanes'), in_hw)
            in_def = road_defaults(in_hw)
            in_ff = min(parse_maxspeed(in_data.get('maxspeed'), in_hw), in_def['ff_spd'])
            in_coords = link_shape[(in_u, in_v, in_k)]
            in_brg = link_end_bearing(in_coords)

            for out_lid, out_u, out_v, out_k in outs:
                # U-턴 제외
                if in_u == out_v and in_v == out_u:
                    continue

                out_data = G[out_u][out_v][out_k]
                out_hw = out_data.get('highway', '_default')
                out_nlanes = parse_lanes(out_data.get('lanes'), out_hw)
                out_def = road_defaults(out_hw)
                out_ff = min(parse_maxspeed(out_data.get('maxspeed'), out_hw), out_def['ff_spd'])
                out_coords = link_shape[(out_u, out_v, out_k)]
                out_brg = link_start_bearing(out_coords)

                diff = angle_diff(in_brg, out_brg)
                turning = classify_turn(diff)

                # connection ff_spd (교차로 내부 속도)
                if turning == 'S':
                    conn_ff = min(in_ff, out_ff)
                elif turning == 'L':
                    conn_ff = min(30.0, in_ff, out_ff)
                else:  # R
                    conn_ff = min(35.0, in_ff, out_ff)

                conn_len = estimate_conn_length(in_coords, out_coords, turning, (lx, ly))
                conn_width = out_def['lane_w']

                for from_l, to_l in assign_lane_pairs(in_nlanes, out_nlanes, turning):
                    connections.append({
                        'id': conn_id,
                        'from_link': in_lid,
                        'from_lane': from_l,
                        'to_link': out_lid,
                        'to_lane': to_l,
                        'turning': turning,
                        'length': conn_len,
                        'width': conn_width,
                        'ff_spd': conn_ff,
                    })
                    conn_id += 1

        # ── <node> 엘리먼트 ───────────────────────────────────────────────
        node_elem = ET.SubElement(nodes_elem, 'node',
            id=str(our_id),
            type=ntype,
            num_port=str(num_port),
            num_connection=str(len(connections)),
            v2x='',
            x_coord=f'{lx:.3f}',
            y_coord=f'{ly:.3f}',
        )

        for in_lid, *_ in ins:
            ET.SubElement(node_elem, 'port', type='in', link_id=str(in_lid), direction='')
        for out_lid, *_ in outs:
            ET.SubElement(node_elem, 'port', type='out', link_id=str(out_lid), direction='')

        for c in connections:
            ET.SubElement(node_elem, 'connection',
                id=str(c['id']),
                from_link=str(c['from_link']),
                from_lane=str(c['from_lane']),
                to_link=str(c['to_link']),
                to_lane=str(c['to_lane']),
                turning=c['turning'],
                length=f"{c['length']:.2f}",
                width=f"{c['width']:.1f}",
                ff_spd=f"{c['ff_spd']:.2f}",
            )

    # ── LINKS ─────────────────────────────────────────────────────────────
    for u, v, k in G.edges(keys=True):
        data = G[u][v][k]
        our_id = link_id_map[(u, v, k)]
        from_nid = node_id_map[u]
        to_nid = node_id_map[v]

        hw = data.get('highway', '_default')
        defs = road_defaults(hw)
        num_lanes = parse_lanes(data.get('lanes'), hw)
        max_spd = parse_maxspeed(data.get('maxspeed'), hw)
        ff_spd = min(max_spd, defs['ff_spd'])
        wave_spd = defs['wave_spd']
        qmax = defs['qmax'] * num_lanes
        length = link_len[(u, v, k)]
        width = round(num_lanes * defs['lane_w'], 1)
        max_veh = calc_max_veh(length, num_lanes)

        # 교차로 진입 링크: stop_line = 차선폭(3.0~3.5)
        to_is_intersection = (node_id_map[v] < 11000000 and
                              v not in terminal_nodes and
                              len(in_links.get(v, [])) + len(out_links.get(v, [])) > 2)
        stop_line = defs['lane_w'] if to_is_intersection else 0.0

        coords = link_shape[(u, v, k)]
        shape_str = ' '.join(f'{x:.5f},{y:.5f}' for x, y in coords)

        link_elem = ET.SubElement(links_elem, 'link',
            id=str(our_id),
            from_node=str(from_nid),
            to_node=str(to_nid),
            num_lane=str(num_lanes),
            length=f'{length:.2f}',
            width=str(width),
            min_spd='0',
            max_spd=str(max_spd),
            ff_spd=str(ff_spd),
            wave_spd=str(wave_spd),
            qmax=str(qmax),
            max_veh=str(max_veh),
            sim_type='0',
            type='straight',
            layer='',
            stop_line=str(stop_line),
            shape=shape_str,
        )

        # ── <lane> 엘리먼트 ───────────────────────────────────────────────
        n_cells = calc_num_cells(length)
        # 셀 길이: 기준 셀 길이로 균등 분할, 마지막 셀에 나머지
        base = min(BASE_CELL_LEN, length / n_cells)
        remainder = length - base * (n_cells - 1)

        for lane_id in range(num_lanes):
            left_id = str(lane_id - 1) if lane_id > 0 else 'None'
            right_id = str(lane_id + 1) if lane_id < num_lanes - 1 else 'None'

            lane_elem = ET.SubElement(link_elem, 'lane',
                id=str(lane_id),
                num_cell=str(n_cells),
                left_lane_id=left_id,
                right_lane_id=right_id,
            )

            offset = 0.0
            for cell_id in range(n_cells):
                cell_len = remainder if cell_id == n_cells - 1 else base
                ET.SubElement(lane_elem, 'cell',
                    id=str(cell_id),
                    length=f'{cell_len:.2f}',
                    offset=f'{offset:.2f}',
                )
                offset += cell_len

    return root


# ─── XML 출력 ────────────────────────────────────────────────────────────────

def write_pretty_xml(root: ET.Element, output_path: str) -> None:
    rough = ET.tostring(root, 'unicode', xml_declaration=False)
    reparsed = minidom.parseString(rough)
    pretty = reparsed.toprettyxml(indent='  ', encoding='UTF-8').decode('utf-8')
    # minidom이 추가하는 첫 줄 xml 선언을 원하는 형식으로 교체
    lines = pretty.split('\n', 1)
    result = "<?xml version='1.0' encoding='UTF-8'?>\n" + lines[1]
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(result)


# ─── OSM 데이터 로드 ─────────────────────────────────────────────────────────

def load_graph(args) -> object:
    """인수에 따라 osmnx 그래프 로드"""
    print("OSM 데이터 로드 중...", flush=True)

    simplify = not args.no_simplify
    ntype = args.network_type

    if args.place:
        G = ox.graph_from_place(args.place, network_type=ntype, simplify=simplify)
    elif args.bbox:
        south, west, north, east = args.bbox
        # osmnx v1.x / v2.x 모두 대응
        try:
            G = ox.graph_from_bbox(north, south, east, west,
                                   network_type=ntype, simplify=simplify)
        except TypeError:
            G = ox.graph_from_bbox((north, south, east, west),
                                   network_type=ntype, simplify=simplify)
    elif args.osm:
        G = ox.graph_from_xml(args.osm, simplify=simplify)
    else:
        raise ValueError("입력 소스를 지정하세요: --place / --bbox / --osm")

    return G


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='OSM 도로 네트워크 → IITP network.xml 변환',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument('--place', metavar='PLACE',
                     help='장소명 (예: "강남구, 서울")')
    src.add_argument('--bbox', nargs=4, type=float,
                     metavar=('SOUTH', 'WEST', 'NORTH', 'EAST'),
                     help='바운딩 박스 (예: 37.49 127.02 37.52 127.06)')
    src.add_argument('--osm', metavar='FILE',
                     help='OSM 파일 경로 (.osm / .osm.bz2 / .osm.pbf)')

    parser.add_argument('-o', '--output', default='network.xml',
                        help='출력 파일 경로 (기본값: network.xml)')
    parser.add_argument('--base-lat', type=float,
                        help='로컬 좌표 원점 위도 (기본값: 네트워크 중심)')
    parser.add_argument('--base-lon', type=float,
                        help='로컬 좌표 원점 경도 (기본값: 네트워크 중심)')
    parser.add_argument('--network-type', default='drive',
                        choices=['drive', 'drive_service', 'walk', 'bike', 'all'],
                        help='도로 유형 필터 (기본값: drive)')
    parser.add_argument('--no-simplify', action='store_true',
                        help='osmnx 그래프 단순화 비활성화')
    parser.add_argument('--network-id', type=int, default=0,
                        help='Network 엘리먼트 id 속성 (기본값: 0)')

    args = parser.parse_args()

    # 그래프 로드
    G = load_graph(args)
    print(f"  → 노드 {len(G.nodes())}개, 에지 {len(G.edges())}개", flush=True)

    # 원점 좌표 결정
    if args.base_lat is not None and args.base_lon is not None:
        base_lat, base_lon = args.base_lat, args.base_lon
    else:
        lats = [d['y'] for _, d in G.nodes(data=True)]
        lons = [d['x'] for _, d in G.nodes(data=True)]
        base_lat = sum(lats) / len(lats)
        base_lon = sum(lons) / len(lons)

    print(f"  → 원점 좌표: lat={base_lat:.6f}, lon={base_lon:.6f}", flush=True)
    print("XML 생성 중...", flush=True)

    root = build_network_xml(G, base_lat, base_lon, args.network_id)

    n_nodes = len(list(root.find('nodes')))
    n_links = len(list(root.find('links')))
    n_conns = sum(
        len(node.findall('connection'))
        for node in root.find('nodes').findall('node')
    )

    write_pretty_xml(root, args.output)

    print(f"저장 완료: {args.output}")
    print(f"  노드: {n_nodes}개  (내부: {sum(1 for n in root.find('nodes') if int(n.get('id','0')) < 11000000)}개,"
          f"  터미널: {sum(1 for n in root.find('nodes') if int(n.get('id','0')) >= 11000000)}개)")
    print(f"  링크: {n_links}개")
    print(f"  커넥션: {n_conns}개")
    print()
    print("[주의] connection의 차선별 연결은 휴리스틱 기반입니다.")
    print("       실제 시뮬레이션 전에 교차로 connection을 검토/수정하세요.")
    print(f"       로컬 좌표 원점: lat={base_lat:.6f}, lon={base_lon:.6f}")
    print("       시나리오 설정에 동일한 base 좌표를 등록하세요.")


if __name__ == '__main__':
    main()
