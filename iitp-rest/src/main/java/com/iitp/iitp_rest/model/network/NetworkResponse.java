package com.iitp.iitp_rest.model.network;

import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class NetworkResponse {
    private List<NodeResponse> nodes = new ArrayList<>();
    private List<LinkResponse> links = new ArrayList<>();
    /** 2점 캘리브레이션 축척 배율(NetworkXml.baseScale 미러) — 타일 빌드 시 width 보정에 필요 */
    private Double baseScale;
    // ⚠️ id/baseLat/baseLon/baseRotation 이 없어서 NetworkXml → NetworkResponse → NetworkXml
    // 왕복(diff 저장·전체 저장의 network.xml 동기화 경로)마다 이 필드들이 소실되고 있었다.
    // baseLat/baseLon 이 없으면 링크 shape(로컬 좌표 문자열)도 원점을 잃어 재파싱 불가 →
    // link_rtree 가 통째로 비어 "네트워크 데이터 없음"으로 이어짐(2026-08-03 실사용 재현).
    // NetworkXml 과 동일 필드명으로 둬서 NetworkMapper(MapStruct)가 자동으로 왕복 보존하게 한다.
    private Long id;
    private Double baseLat;
    private Double baseLon;
    private Double baseRotation;
}
