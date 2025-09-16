package com.iitp.iitp_rest.model.network.port;

import com.iitp.iitp_rest.mapper.AbstractEnumAdapter;


public class PortTypeAdapter extends AbstractEnumAdapter<PortType, String> {
    public PortTypeAdapter() {
        super(PortType.class);
    }
}
