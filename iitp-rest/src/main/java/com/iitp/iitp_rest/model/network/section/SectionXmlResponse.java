package com.iitp.iitp_rest.model.network.section;

import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlAttribute;
import lombok.Data;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class SectionXmlResponse {
    @XmlAttribute
    private Long id;
    @XmlAttribute
    private String left_id;
    @XmlAttribute
    private String right_id;
    @XmlAttribute
    private Double slope;
    @XmlAttribute
    private Double length;
    @XmlAttribute
    private Double offset;
}
