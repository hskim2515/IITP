package com.iitp.iitp_rest.model.network.section;

import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlAttribute;
import lombok.Data;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class SectionXml {
    @XmlAttribute
    private Long id;
    @XmlAttribute(name = "left_id")
    private String leftId = "";
    @XmlAttribute(name = "right_id")
    private String rightId = "";
    // SegmentXml.block과 동일 패턴 회귀 방지 — 지금은 <section>을 실제로 생성하는 코드가
    // 없어 잠재 상태지만(코드베이스 전체 검색 결과 setSlope/setLength/setOffset 호출 0건),
    // boxed Double을 null로 두면 나중에 이 기능이 구현될 때 JAXB가 속성을 통째로 생략해
    // NextSim이 다시 크래시할 수 있다 — 미리 기본값을 둬 둔다.
    @XmlAttribute
    private Double slope = 0.0;
    @XmlAttribute
    private Double length = 0.0;
    @XmlAttribute
    private Double offset = 0.0;
}
