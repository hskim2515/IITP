package com.iitp.iitp_rest.model.network.link;

import com.iitp.iitp_rest.mapper.AbstractEnumAdapter;

public class SimTypeAdapter extends AbstractEnumAdapter<SimType, Integer> {
    public SimTypeAdapter() {
        super(SimType.class);
    }
}
