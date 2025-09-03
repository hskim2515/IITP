package com.iitp.iitp_rest.model.network.node;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import jakarta.xml.bind.annotation.*;
import jakarta.xml.bind.annotation.adapters.XmlJavaTypeAdapter;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class NodeResponse {
    @XmlAttribute
    private Long id;
    @XmlAttribute
    @XmlJavaTypeAdapter(NodeTypeAdapter.class)
    private NodeType type;
    @XmlAttribute(name = "num_port")
    private int numPort;
    @XmlAttribute(name = "num_connection")
    private int numConnection;
    @XmlAttribute
    @XmlJavaTypeAdapter(V2xAdapter.class)
    private V2x v2x;
    @XmlAttribute
    private String center;
    @XmlTransient
    private Coordinates coordinates;
    @XmlElement(name = "port")
    private List<PortResponse> ports = new ArrayList<>();
    @XmlElement(name = "connection")
    private List<ConnectionResponse> connections = new ArrayList<>();
    @XmlTransient
    private List<String> portLinkIds = new ArrayList<>();
}
