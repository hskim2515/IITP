package com.iitp.iitp_rest.model.network.node;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.iitp.iitp_rest.model.common.DbMappedEnum; // 실제 경로에 맞게 수정
import lombok.Getter;

import java.util.stream.Stream;

@Getter
public enum NodeType implements DbMappedEnum<String> {

    Intersection("intersection"),
    Normal("normal"),
    Merging("merging"),
    Diverging("diverging"),
    Terminal("terminal"),
    Garage("garage"); // 인터페이스 정의서에 없으나, 데이터에 있음.

    private final String value;

    NodeType(String value) {
        this.value = value;
    }

    @Override
    public String getValue() {
        return this.value;
    }

    @JsonCreator
    public static NodeType fromValue(String value) {
        return Stream.of(NodeType.values())
                .filter(type -> type.getValue().equals(value))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unsupported value: " + value));
    }
}