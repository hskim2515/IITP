package com.iitp.iitp_rest.model.network;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class NodeData {
    public String id;
    public String type;
    public int numPort;
    public int numConnection;
    public String center;
    public List<PortData> ports = new ArrayList<>();
    public List<ConnectionData> connections = new ArrayList<>();
    public List<String> portLinkIds = new ArrayList<>();
}
