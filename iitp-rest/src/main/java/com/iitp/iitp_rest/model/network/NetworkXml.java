package com.iitp.iitp_rest.model.network;

import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import jakarta.xml.bind.annotation.*;
import lombok.Data;

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
    @XmlElementWrapper
    @XmlElement(name = "node")
    private List<NodeXml> nodes;
    @XmlElementWrapper
    @XmlElement(name = "link")
    private List<LinkXml> links;
}
