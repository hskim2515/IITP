package com.iitp.iitp_rest.model.pavementMarking;

import jakarta.persistence.Column;
import lombok.Data;
import com.vladmihalcea.hibernate.type.json.JsonType;
import org.hibernate.annotations.Type;

import java.util.List;
import java.util.Map;

// 2. 로그 객체
@Data
public class UpdateLog {
    private String versionId;
    private String timestamp;

    @Type(JsonType.class)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> json;
}