package com.iitp.iitp_rest.model.osm;

import lombok.Data;

import java.util.List;
import java.util.Map;

@Data
public class OsmWay {
    private long id;
    private List<Long> nodeIds;
    private Map<String, String> tags;

    public String getTag(String key) {
        return tags != null ? tags.get(key) : null;
    }

    /** oneway=yes/true/1 또는 motorway 계열은 단방향 (정방향만) */
    public boolean isOneway() {
        String val = getTag("oneway");
        if ("yes".equals(val) || "true".equals(val) || "1".equals(val)) return true;
        String hw = getTag("highway");
        return "motorway".equals(hw) || "motorway_link".equals(hw);
    }

    /** oneway=-1 또는 reverse → 역방향만 */
    public boolean isReverseOneway() {
        String val = getTag("oneway");
        return "-1".equals(val) || "reverse".equals(val);
    }
}
