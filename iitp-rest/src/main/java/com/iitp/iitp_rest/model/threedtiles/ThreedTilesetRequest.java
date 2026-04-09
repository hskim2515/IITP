package com.iitp.iitp_rest.model.threedtiles;

import lombok.Data;

import java.util.List;

@Data
public class ThreedTilesetRequest {
    private String label;
    private int sortOrder;
    private List<String> urls;
}
