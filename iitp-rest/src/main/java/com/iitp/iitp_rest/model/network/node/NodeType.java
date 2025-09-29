package com.iitp.iitp_rest.model.network.node;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.iitp.iitp_rest.mapper.DbMappedEnum;
import lombok.Getter;

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
        return DbMappedEnum.fromValue(NodeType.class, value);
    }
}