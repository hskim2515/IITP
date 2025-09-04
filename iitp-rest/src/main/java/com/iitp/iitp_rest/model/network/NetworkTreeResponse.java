package com.iitp.iitp_rest.model.network;

import com.iitp.iitp_rest.model.network.link.LinkTreeResponse;
import com.iitp.iitp_rest.model.network.node.NodeTreeResponse;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
public class NetworkTreeResponse {
    private Long id;
    private String name;
    private List<NodeTreeResponse> nodes;
    private List<LinkTreeResponse> links;

    public NetworkTreeResponse(Long id, String name) {
        this.id = id;
        this.name = name;
    }

    public void addNode(NodeTreeResponse node) {
        this.nodes.add(node);
    }

    public void addLink(LinkTreeResponse link) {
        this.links.add(link);
    }
}
