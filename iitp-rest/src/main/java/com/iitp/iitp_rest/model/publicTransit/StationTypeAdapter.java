package com.iitp.iitp_rest.model.publicTransit;

import com.iitp.iitp_rest.model.adapter.AbstractEnumAdapter;

public class StationTypeAdapter extends AbstractEnumAdapter<StationType, String> {
    public StationTypeAdapter() {
        super(StationType.class);
    }
}
