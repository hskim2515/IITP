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
    @XmlElementWrapper
    @XmlElement(name = "node")
    private List<NodeXml> nodes;
    @XmlElementWrapper
    @XmlElement(name = "link")
    private List<LinkXml> links;
}
