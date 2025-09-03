package com.iitp.iitp_rest.model.network.link;

import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlAttribute;
import lombok.Data;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class SegmentResponse {
    @XmlAttribute
    private Long id;
    @XmlAttribute
    private boolean block;
    @XmlAttribute
    private double initPoint;
    @XmlAttribute
    private double endPoint;
}

