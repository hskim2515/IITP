package com.iitp.iitp_rest.model.network.port;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.iitp.iitp_rest.mapper.DbMappedEnum;
import lombok.Getter;

@Getter
public enum PortType implements DbMappedEnum<String> {
    //    in(0), // 인터페이스 정의서와 매칭X
//    out(1);
    in("in"),
    out("out");

    private final String value;

    PortType(String value) {
        this.value = value;
    }

    @Override
    public String getValue() {
        return value;
    }

    @JsonCreator
    public static PortType fromValue(String value) {
        return DbMappedEnum.fromValue(PortType.class, value);
    }
}