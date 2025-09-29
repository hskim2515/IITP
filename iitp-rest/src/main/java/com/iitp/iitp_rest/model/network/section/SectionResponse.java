package com.iitp.iitp_rest.model.network.section;

import lombok.Data;

@Data
public class SectionResponse {
    private Long id;
    private String leftId;
    private String rightId;
    private Double slope;
    private Double length;
    private Double offset;
}
