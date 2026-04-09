package com.iitp.iitp_rest.model.threedtiles;

import lombok.Data;

import java.util.List;

@Data
public class ThreedTilesetResponse {
    private Long id;
    private String label;
    private int sortOrder;
    private List<String> urls;
}
