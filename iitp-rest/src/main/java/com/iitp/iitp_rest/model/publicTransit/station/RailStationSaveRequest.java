package com.iitp.iitp_rest.model.publicTransit.station;

import com.iitp.iitp_rest.model.LogsData;
import lombok.Data;

import java.sql.Timestamp;
import java.util.List;

@Data
// 1. 최상위 요청 DTO
public class RailStationSaveRequest {
    private Timestamp timestamp;
    private List<RailStationData> data;
    private LogsData logs;
}
