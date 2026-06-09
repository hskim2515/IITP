package com.iitp.iitp_rest.model.osm;

import lombok.Data;

import java.util.Map;

@Data
public class OsmNode {
    private long id;
    private double lat;
    private double lon;
    private Map<String, String> tags;

    public String getTag(String key) {
        return tags != null ? tags.get(key) : null;
    }
}
