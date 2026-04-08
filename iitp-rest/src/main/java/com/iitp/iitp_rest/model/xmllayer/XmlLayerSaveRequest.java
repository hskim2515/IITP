package com.iitp.iitp_rest.model.xmllayer;

import com.iitp.iitp_rest.model.LogsData;
import lombok.Data;

import java.util.Map;

/**
 * XML 레이어 저장 공통 요청 DTO.
 * data: 프론트엔드 currentJsonData 전체 (Map)
 * logs: mergeUpdateLogs 결과 (added/modified/deleted)
 */
@Data
public class XmlLayerSaveRequest {
    private Map<String, Object> data;
    private LogsData logs;
}
