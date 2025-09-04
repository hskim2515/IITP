package com.iitp.iitp_rest.model.network.node;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.connection.ConnectionXmlResponse;
import com.iitp.iitp_rest.model.network.port.PortResponse;
import com.iitp.iitp_rest.model.network.port.PortXmlResponse;
import jakarta.xml.bind.annotation.*;
import jakarta.xml.bind.annotation.adapters.XmlJavaTypeAdapter;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
@XmlAccessorType(XmlAccessType.NONE)
public class NodeXmlResponse {
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
    @XmlElement(name = "port")
    private List<PortXmlResponse> ports = new ArrayList<>();
    @XmlElement(name = "connection")
    private List<ConnectionXmlResponse> connections = new ArrayList<>();

    @XmlTransient
    private Coordinates coordinates;
    @XmlTransient
    private List<String> portLinkIds = new ArrayList<>();

}
