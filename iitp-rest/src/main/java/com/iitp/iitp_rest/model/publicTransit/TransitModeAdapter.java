package com.iitp.iitp_rest.model.publicTransit;

import com.iitp.iitp_rest.mapper.AbstractEnumAdapter;

public class TransitModeAdapter extends AbstractEnumAdapter<TransitMode, String> {
    public TransitModeAdapter() {
        super(TransitMode.class);
    }
}
