package com.iitp.iitp_rest.model.network.node;

import com.iitp.iitp_rest.model.adapter.AbstractEnumAdapter;
import com.iitp.iitp_rest.model.network.link.SimType;


public class NodeTypeAdapter extends AbstractEnumAdapter<NodeType, String> {
    public NodeTypeAdapter() {
        super(NodeType.class);
    }
}
