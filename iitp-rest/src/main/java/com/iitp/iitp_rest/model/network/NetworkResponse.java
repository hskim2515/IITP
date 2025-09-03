package com.iitp.iitp_rest.model.network;

import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
import jakarta.xml.bind.annotation.*;
import lombok.Data;

import java.util.List;

@Data
@XmlRootElement(name = "Network")
@XmlAccessorType(XmlAccessType.FIELD)
public class NetworkResponse {
    @XmlTransient
    private String name;
    @XmlAttribute
    private Long id;
    @XmlElementWrapper
    @XmlElement(name = "node")
    private List<NodeResponse> nodes;
    @XmlElementWrapper
    @XmlElement(name = "link")
    private List<LinkResponse> links;
}
