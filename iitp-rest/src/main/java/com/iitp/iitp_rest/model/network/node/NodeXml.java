package com.iitp.iitp_rest.model.network.node;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.connection.ConnectionXml;
import com.iitp.iitp_rest.model.network.port.PortXml;
import jakarta.xml.bind.annotation.*;
import jakarta.xml.bind.annotation.adapters.XmlJavaTypeAdapter;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class NodeXml {
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
    /** 교차로 명칭 (표준노드링크 NODE_NAME 등 원본 유래, 옵셔널) */
    @XmlAttribute
    private String name;
    @XmlElement(name = "port")
    private List<PortXml> ports = new ArrayList<>();
    @XmlElement(name = "connection")
    private List<ConnectionXml> connections = new ArrayList<>();

    @XmlTransient
    private Coordinates coordinates;
    @XmlTransient
    private List<String> portLinkIds = new ArrayList<>();

}
