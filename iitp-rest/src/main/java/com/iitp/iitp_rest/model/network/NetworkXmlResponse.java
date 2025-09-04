package com.iitp.iitp_rest.model.network;

import com.iitp.iitp_rest.model.network.link.LinkXmlResponse;
import com.iitp.iitp_rest.model.network.node.NodeXmlResponse;
import jakarta.xml.bind.annotation.*;
import lombok.Data;

import java.util.List;

@Data
@XmlRootElement(name = "Network")
@XmlAccessorType(XmlAccessType.FIELD)
public class NetworkXmlResponse {
    @XmlAttribute
    private Long id;
    @XmlElementWrapper
    @XmlElement(name = "node")
    private List<NodeXmlResponse> nodes;
    @XmlElementWrapper
    @XmlElement(name = "link")
    private List<LinkXmlResponse> links;
}
