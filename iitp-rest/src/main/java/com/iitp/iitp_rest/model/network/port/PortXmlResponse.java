package com.iitp.iitp_rest.model.network.port;

import jakarta.xml.bind.annotation.XmlAccessType;
import jakarta.xml.bind.annotation.XmlAccessorType;
import jakarta.xml.bind.annotation.XmlAttribute;
import jakarta.xml.bind.annotation.adapters.XmlJavaTypeAdapter;
import lombok.Data;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class PortXmlResponse {
    @XmlAttribute
    @XmlJavaTypeAdapter(PortTypeAdapter.class)
    private PortType type;
    @XmlAttribute(name = "link_id")
    private String linkId;
    @XmlAttribute
    private Long direction;
}
