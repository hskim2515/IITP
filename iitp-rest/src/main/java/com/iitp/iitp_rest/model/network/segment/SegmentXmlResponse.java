package com.iitp.iitp_rest.model.network.segment;

import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlAttribute;
import lombok.Data;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class SegmentXmlResponse {
    @XmlAttribute
    private Long id;
    @XmlAttribute
    private Boolean block;
    @XmlAttribute
    private double initPoint;
    @XmlAttribute
    private double endPoint;
}

