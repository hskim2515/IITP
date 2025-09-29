package com.iitp.iitp_rest.model.network.cell;

import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlAttribute;
import lombok.Data;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class CellXml {
    @XmlAttribute
    private Long id;
    @XmlAttribute
    private double length;
    @XmlAttribute
    private double offset;
}

