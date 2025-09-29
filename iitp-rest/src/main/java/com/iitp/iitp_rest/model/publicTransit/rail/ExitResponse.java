package com.iitp.iitp_rest.model.publicTransit.rail;

import lombok.Data;

@Data
public class ExitResponse {
    private String id;

    private String linkRef;

    private Double offset;

    private String accessTime;

    private String coord;
}
