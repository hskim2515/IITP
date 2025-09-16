package com.iitp.iitp_rest.model.publicTransit.rail;

import lombok.Data;

import java.util.List;

@Data
public class TimetableResponse {
    private String dayOfWeek;
    private String lineId;
    private List<String> times;
}
