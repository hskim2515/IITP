package com.iitp.iitp_rest.model.layer;

import lombok.Data;

@Data
public class LayerResponse {
    private Long id;

    private String key;

    private String label;

    private Boolean basic;

    private Integer auth;

    private String formType;

    private String url;

    private String groupKey;
}
