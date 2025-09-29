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
    private String leftId;
    @XmlAttribute(name = "right_id")
    private String rightId;
    @XmlAttribute
    private Double slope;
    @XmlAttribute
    private Double length;
    @XmlAttribute
    private Double offset;
}
