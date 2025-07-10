package com.iitp.iitp_rest.model;

import lombok.Data;

import java.util.List;

@Data
public class LogsData {

    private List<Detail> added;
    private List<Detail> deleted;
    private List<Detail> modified;
    @Data
    private static class Detail {
        private String field;
        private String newValue;
        private String oldValue;
        private String featureId;
    }
}
