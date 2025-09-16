package com.iitp.iitp_rest.model.network.node;

import com.iitp.iitp_rest.mapper.AbstractEnumAdapter;

public class NodeTypeAdapter extends AbstractEnumAdapter<NodeType, String> {
    public NodeTypeAdapter() {
        super(NodeType.class);
    }
}
