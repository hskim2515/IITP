package com.iitp.iitp_rest.model.pavementMarking;

import com.iitp.iitp_rest.model.LogsData;
import lombok.Data;

import java.sql.Timestamp;
import java.util.List;

@Data
// 1. 최상위 요청 DTO
public class PavementMarkingSaveRequest {
    //private Timestamp timestamp;
    private List<PavementMarkingData> data;
    private LogsData logs;
}
