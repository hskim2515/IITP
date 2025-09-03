package com.iitp.iitp_rest.model.network.link;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.iitp.iitp_rest.model.common.DbMappedEnum;
import lombok.Getter;

import java.util.stream.Stream;

@Getter
public enum LinkType implements DbMappedEnum<String> {

    straight("straight"),
    curve("curve");

    private final String value;

    LinkType(String value) {
        this.value = value;
    }

    @Override
    public String getValue() {
        return this.value;
    }

    @JsonCreator
    public static LinkType fromValue(String value) {
        return Stream.of(LinkType.values())
                .filter(type -> type.getValue().equals(value))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unsupported value: " + value));
    }
}