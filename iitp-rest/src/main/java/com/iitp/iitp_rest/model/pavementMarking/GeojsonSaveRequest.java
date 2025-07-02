package com.iitp.iitp_rest.model.pavementMarking;

import lombok.Data;

import java.util.List;
import java.util.Map;
@Data
// 1. 최상위 요청 DTO
public class GeojsonSaveRequest {
    private Long versionId;
    private Map<String, Object> geojson;
    private List<UpdateLog> logJson;
}




