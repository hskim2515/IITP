package com.iitp.iitp_rest.model.network;

import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import jakarta.xml.bind.annotation.*;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
@XmlRootElement(name = "Network")
@XmlAccessorType(XmlAccessType.FIELD)
public class NetworkXml {
    @XmlAttribute
    private Long id;
    /** 로컬 좌표 원점 위도 — 재로드 시 동일한 base 사용 보장 */
    @XmlAttribute(name = "base_lat")
    private Double baseLat;
    /** 로컬 좌표 원점 경도 — 재로드 시 동일한 base 사용 보장 */
    @XmlAttribute(name = "base_lon")
    private Double baseLon;
    /** 로컬 shape 좌표계 회전각(도) — 2점 캘리브레이션 결과. 없으면 0(회전 없음) */
    @XmlAttribute(name = "base_rotation")
    private Double baseRotation;
    /** 로컬 shape 좌표계 축척 배율 — 2점 캘리브레이션 결과. 없으면 1(원본 크기) */
    @XmlAttribute(name = "base_scale")
    private Double baseScale;
    // ⚠️ 기본값(new ArrayList<>()) 없으면 <nodes>/<links> 래퍼 엘리먼트 자체가 없는 XML(예:
    // footpathNetwork.xml — 보행자 전용이라 링크가 없는 게 정상)에서 JAXB가 null로 남겨,
    // getLinks().forEach(...) 하는 호출부마다 NPE가 난다(2026-08-03 실사용 재현).
    @XmlElementWrapper
    @XmlElement(name = "node")
    private List<NodeXml> nodes = new ArrayList<>();
    @XmlElementWrapper
    @XmlElement(name = "link")
    private List<LinkXml> links = new ArrayList<>();
}
