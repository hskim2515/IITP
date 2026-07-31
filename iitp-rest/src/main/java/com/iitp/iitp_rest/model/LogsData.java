package com.iitp.iitp_rest.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

import java.util.List;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class LogsData {

    private List<Detail> added;
    private List<Detail> deleted;
    private List<Detail> modified;

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    private static class Detail {
        private String field;
        private Object newValue;
        private Object oldValue;
        private String guid;
        private String timestamp;
        private String scope;
        private String transactionId;
    }
}
