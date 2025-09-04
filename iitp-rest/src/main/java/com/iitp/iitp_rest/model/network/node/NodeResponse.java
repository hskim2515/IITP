package com.iitp.iitp_rest.model.network.node;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class NodeResponse {
    private Long id;
    private NodeType type;
    private int numPort;
    private int numConnection;
    private V2x v2x;
    private String center;
    private Coordinates coordinates;
    private List<String> portLinkIds = new ArrayList<>();
}
