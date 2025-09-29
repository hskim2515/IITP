package com.iitp.iitp_rest.model.publicTransit.rail;

import lombok.Builder;
import lombok.Data;


@Data
@Builder
public class ExitData {
    private String id;
    private int linkRef;
    private double offset;
    private double accessTime;
    private String coord;

}