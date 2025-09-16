package com.iitp.iitp_rest.model.layer;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;

@Data
public class LayerGroupResponse {
    private Long id;

    private String key;

    private String label;

    private List<LayerResponse> layers = new ArrayList<>();
}
