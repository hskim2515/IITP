package com.iitp.iitp_rest.model.pavementMarking;

import lombok.Data;

import java.sql.Timestamp;
import java.util.Map;
@Data
// 1. 최상위 요청 DTO
public class JsonSaveRequest {
    private Timestamp timestamp;
    private Map<String, Object> geojson;
    private Map<String, Object> logJson;
}




