package com.iitp.iitp_rest.model.network.node;

import com.iitp.iitp_rest.model.adapter.AbstractEnumAdapter;


public class PortTypeAdapter extends AbstractEnumAdapter<PortType, String> {
    public PortTypeAdapter() {
        super(PortType.class);
    }
}
