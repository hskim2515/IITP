package com.iitp.iitp_rest.model.network.segment;

import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlAttribute;
import lombok.Data;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class SegmentXml {
    @XmlAttribute
    private Long id;
    // NextSim(route-generator/nextsim 배포판)이 실제로 요구하는 필수 속성 —
    // 프론트 lane 병합(concatLaneDerived 등, 통과 노드 삭제 시 두 lane을 이어붙이는 로직)이
    // 세그먼트를 만들 때 block을 세팅한 적이 없어 항상 null이었고, JAXB는 null Boolean
    // 속성을 아예 생략해버린다 — NextSimIO가 이 속성 부재를 strcmp(NULL, "True")로 읽어
    // SIGSEGV(실측, gdb 백트레이스로 NextSimIO::ArcArr::ArcArr() 확인). 필드 기본값을
    // false로 둬 프론트가 값을 안 보내도 항상 속성이 나가게 한다.
    @XmlAttribute
    private Boolean block = Boolean.FALSE;
    // NextSim 배포판 예시(bucheon)는 init_point/end_point(스네이크 케이스)를 쓰는데
    // 기존엔 필드명 그대로(camelCase: initPoint/endPoint)로 마샬링되고 있었다 — route-generator는
    // 이 이름 불일치를 허용했지만 nextsim(실제 시뮬 엔진)은 "Element should have 'init_point'
    // attribute" 예외로 즉시 실패함이 실측 확인됨.
    @XmlAttribute(name = "init_point")
    private double initPoint;
    @XmlAttribute(name = "end_point")
    private double endPoint;
    // NextSim 배포판 예시에 존재하는 속성 — 우리 쪽에서 지금까지 아예 방출한 적이 없었다.
    // 차선 변경 가능 방향 표시로 추정되며, 빈 문자열(제한 없음)을 기본값으로 둔다.
    @XmlAttribute(name = "right_lc")
    private String rightLc = "";
    @XmlAttribute(name = "left_lc")
    private String leftLc = "";
}

