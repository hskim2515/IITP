package com.iitp.iitp_rest.model.publicTransit.rail;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlAttribute;
import jakarta.xml.bind.annotation.XmlTransient;
import lombok.Data;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class ExitXml {

    @XmlAttribute
    private Long id;
    @XmlAttribute
    private Long linkRef;
    @XmlAttribute
    private Double offset;
    @XmlAttribute
    private Long accessTime;
    @XmlAttribute
    private String coord;

    @XmlTransient
    private Coordinates coordinates;
}
