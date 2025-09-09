package com.iitp.iitp_rest.model.network.link;

import com.iitp.iitp_rest.model.adapter.AbstractEnumAdapter;

public class LinkTypeAdapter extends AbstractEnumAdapter<LinkType, String> {
    public LinkTypeAdapter() {
        super(LinkType.class);
    }
}
