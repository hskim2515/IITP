"""
VWorld 위성지도 타일 가져오기 + bbox 범위 병합 이미지 생성
"""
from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass

import httpx
import mercantile
import numpy as np
from PIL import Image


TILE_SIZE = 256  # 픽셀


@dataclass
class TileBounds:
    """타일 집합의 픽셀 경계 정보"""
    image: np.ndarray          # (H, W, 3) uint8 RGB
    west: float
    south: float
    east: float
    north: float
    zoom: int
    x_min: int
    y_min: int
    px_per_deg_lng: float
    px_per_deg_lat: float

    def lonlat_to_pixel(self, lon: float, lat: float) -> tuple[int, int]:
        """경위도 → 이미지 픽셀 좌표"""
        px = (lon - self.west) * self.px_per_deg_lng
        py = (self.north - lat) * self.px_per_deg_lat
        return int(px), int(py)

    def pixel_to_lonlat(self, px: int, py: int) -> tuple[float, float]:
        """픽셀 좌표 → 경위도"""
        lon = self.west  + px / self.px_per_deg_lng
        lat = self.north - py / self.px_per_deg_lat
        return lon, lat


def _tile_url(api_key: str, z: int, x: int, y: int) -> str:
    return (
        f"https://api.vworld.kr/req/wmts/1.0.0/{api_key}"
        f"/Satellite/{z}/{y}/{x}.jpeg"
    )


def _bbox_to_zoom(south: float, west: float, north: float, east: float,
                  max_tiles: int = 64) -> int:
    """bbox 크기에 맞는 적절한 줌 레벨 계산 (최대 max_tiles 타일)"""
    for z in range(19, 10, -1):
        tiles = list(mercantile.tiles(west, south, east, north, zooms=z))
        if len(tiles) <= max_tiles:
            return z
    return 11


async def fetch_tiles(
    south: float, west: float, north: float, east: float,
    api_key: str,
    zoom: int | None = None,
    max_tiles: int = 64,
) -> TileBounds:
    """bbox에 해당하는 VWorld 위성 타일들을 병합하여 단일 이미지로 반환"""

    z = zoom or _bbox_to_zoom(south, west, north, east, max_tiles)
    tiles = list(mercantile.tiles(west, south, east, north, zooms=z))

    if not tiles:
        raise ValueError("bbox에 해당하는 타일이 없습니다.")

    xs = [t.x for t in tiles]
    ys = [t.y for t in tiles]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)

    cols = x_max - x_min + 1
    rows = y_max - y_min + 1
    canvas = Image.new("RGB", (cols * TILE_SIZE, rows * TILE_SIZE), (0, 0, 0))

    async def _fetch_one(client: httpx.AsyncClient, tile: mercantile.Tile) -> tuple:
        url = _tile_url(api_key, tile.z, tile.x, tile.y)
        try:
            resp = await client.get(url, timeout=10.0)
            resp.raise_for_status()
            from io import BytesIO
            img = Image.open(BytesIO(resp.content)).convert("RGB")
            return tile, img
        except Exception:
            return tile, None

    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(*[_fetch_one(client, t) for t in tiles])

    for tile, img in results:
        if img is None:
            continue
        col = tile.x - x_min
        row = tile.y - y_min
        canvas.paste(img, (col * TILE_SIZE, row * TILE_SIZE))

    # 타일 집합의 실제 경계 (mercantile bounds)
    nw = mercantile.bounds(x_min, y_min, z)
    se = mercantile.bounds(x_max, y_max, z)

    tile_west  = nw.west
    tile_north = nw.north
    tile_east  = se.east
    tile_south = se.south

    img_w = cols * TILE_SIZE
    img_h = rows * TILE_SIZE
    px_per_deg_lng = img_w / (tile_east  - tile_west)
    px_per_deg_lat = img_h / (tile_north - tile_south)

    return TileBounds(
        image          = np.array(canvas),
        west           = tile_west,
        south          = tile_south,
        east           = tile_east,
        north          = tile_north,
        zoom           = z,
        x_min          = x_min,
        y_min          = y_min,
        px_per_deg_lng = px_per_deg_lng,
        px_per_deg_lat = px_per_deg_lat,
    )
