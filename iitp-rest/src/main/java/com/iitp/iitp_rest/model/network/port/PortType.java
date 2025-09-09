package com.iitp.iitp_rest.model.network.port;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.iitp.iitp_rest.model.common.DbMappedEnum;
import lombok.Getter;

import java.util.stream.Stream;

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
        return Stream.of(PortType.values())
                .filter(type -> type.getValue().equals(value))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unsupported value: " + value));
    }
}