package com.iitp.iitp_rest.model.signal;

import com.iitp.iitp_rest.model.LogsData;
import lombok.Data;

import java.util.List;

@Data
// 1. 최상위 요청 DTO
public class SignalSaveRequest {
    private List<SignalResponse> data;
    private LogsData logs;
}
