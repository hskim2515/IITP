"""
iitp-ml FastAPI 서비스
정밀도로지도 또는 표준노드링크 bbox 필터링 기반 자동 네트워크 생성

환경변수:
  DATA_SOURCE       - "hdmap" (정밀도로지도, 기본) 또는 "ktdb" (표준노드링크)

  [정밀도로지도]
  HDMAP_ROOT        - 정밀도로지도 SHP 루트 디렉토리 (필수)

  [표준노드링크]
  KTDB_LINK_SHP     - LINK SHP 절대 경로
  KTDB_NODE_SHP     - NODE SHP 절대 경로
"""
from __future__ import annotations

import asyncio
import glob
import logging
import os
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, Form, HTTPException
from fastapi.responses import JSONResponse, Response

log = logging.getLogger("iitp-ml")

_index     = None
_data_src  = "hdmap"   # "hdmap" | "ktdb"


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _index, _data_src

    _data_src = os.environ.get("DATA_SOURCE", "hdmap").lower()
    log.info("데이터 소스: %s", _data_src)

    try:
        if _data_src == "hdmap":
            hdmap_root = os.environ.get("HDMAP_ROOT", "/data/hdmap")
            if not os.path.isdir(hdmap_root):
                log.warning("HDMAP_ROOT 디렉토리 없음: %s", hdmap_root)
            else:
                from pipeline.hdmap_extractor import HdmapIndex
                log.info("정밀도로지도 인덱스 구축 시작: %s", hdmap_root)
                _index = await asyncio.get_event_loop().run_in_executor(
                    None, HdmapIndex.build, hdmap_root
                )
        else:
            def _resolve(env_key, *patterns):
                p = os.environ.get(env_key, "")
                if p and os.path.isfile(p):
                    return p
                for pat in patterns:
                    found = glob.glob(pat, recursive=True)
                    if found:
                        return found[0]
                return None

            link_shp = _resolve("KTDB_LINK_SHP", "/data/ktdb/**/*LINK*.shp")
            node_shp = _resolve("KTDB_NODE_SHP", "/data/ktdb/**/*NODE*.shp")
            if link_shp and node_shp:
                from pipeline.ktdb_extractor import KtdbIndex
                log.info("표준노드링크 인덱스 구축 시작")
                _index = await asyncio.get_event_loop().run_in_executor(
                    None, KtdbIndex.build, node_shp, link_shp
                )
            else:
                log.warning("표준노드링크 SHP를 찾을 수 없습니다.")

        if _index:
            log.info("인덱스 준비 완료 — 요청 처리 가능")
    except Exception as e:
        log.error("인덱스 구축 실패: %s", e, exc_info=True)

    yield


app = FastAPI(
    title="iitp-ml",
    description="정밀도로지도 / 표준노드링크 bbox 필터링 기반 자동 네트워크 생성",
    version="4.0.0",
    lifespan=lifespan,
)


@app.get("/health")
def health():
    ready = _index is not None
    info  = {"status": "ok", "data_source": _data_src, "ready": ready}
    if ready:
        if _data_src == "hdmap":
            info["link_count"] = len(_index.links) + len(_index.conn_links)
            info["node_count"] = len(_index.nodes)
            info["stopline_count"] = len(_index.stoplines)
            info["signal_count"]   = len(_index.signals)
        else:
            info["link_count"] = len(_index.links)
            info["node_count"] = len(_index.nodes)
    return info


@app.post("/ktdb-to-osm", response_class=Response)
async def ktdb_to_osm(
    south: Annotated[float, Form()],
    west:  Annotated[float, Form()],
    north: Annotated[float, Form()],
    east:  Annotated[float, Form()],
):
    """KTDB 표준노드링크 bbox → OSM XML bytes (netconvert 입력용)"""
    if _index is None or _data_src != "ktdb":
        raise HTTPException(status_code=503, detail="KTDB 인덱스가 준비되지 않았습니다.")
    if south >= north or west >= east:
        raise HTTPException(status_code=400, detail="올바르지 않은 bbox입니다.")
    if north - south > 0.2 or east - west > 0.2:
        raise HTTPException(status_code=400, detail="bbox가 너무 큽니다 (최대 0.2° × 0.2°).")
    try:
        from pipeline.ktdb_extractor import ktdb_to_osm_xml
        xml_bytes = await asyncio.get_event_loop().run_in_executor(
            None, ktdb_to_osm_xml, _index, west, south, east, north,
        )
    except Exception as e:
        log.exception("KTDB→OSM 변환 실패")
        raise HTTPException(status_code=500, detail=f"변환 실패: {e}")

    if not xml_bytes:
        raise HTTPException(status_code=422, detail="해당 bbox에 데이터가 없습니다.")

    log.info("KTDB→OSM 변환 완료: %d bytes", len(xml_bytes))
    return Response(content=xml_bytes, media_type="application/xml")


@app.post("/auto-network/generate")
async def generate_network(
    south: Annotated[float, Form()],
    west:  Annotated[float, Form()],
    north: Annotated[float, Form()],
    east:  Annotated[float, Form()],
):
    if _index is None:
        raise HTTPException(status_code=503, detail="인덱스가 아직 준비되지 않았습니다.")

    if south >= north or west >= east:
        raise HTTPException(status_code=400, detail="올바르지 않은 bbox입니다.")
    if north - south > 0.2 or east - west > 0.2:
        raise HTTPException(status_code=400, detail="bbox가 너무 큽니다 (최대 0.2° × 0.2°).")

    try:
        if _data_src == "hdmap":
            from pipeline.hdmap_extractor import extract_network
        else:
            from pipeline.ktdb_extractor import extract_network

        network = await asyncio.get_event_loop().run_in_executor(
            None, extract_network, _index, west, south, east, north,
        )
    except Exception as e:
        log.exception("네트워크 추출 실패")
        raise HTTPException(status_code=500, detail=f"네트워크 추출 실패: {e}")

    node_count = len(network.get("nodes", []))
    link_count = len(network.get("links", []))

    if node_count == 0:
        raise HTTPException(status_code=422, detail="해당 bbox에 데이터가 없습니다.")

    signal_count = len(network.get("signals", []))
    log.info("네트워크 추출 완료: 노드 %d개, 링크 %d개, 신호 %d개",
             node_count, link_count, signal_count)
    return JSONResponse(content={
        "network": network,
        "stats"  : {"node_count": node_count, "link_count": link_count,
                    "signal_count": signal_count},
    })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
