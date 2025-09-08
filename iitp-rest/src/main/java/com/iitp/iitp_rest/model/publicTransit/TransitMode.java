package com.iitp.iitp_rest.model.publicTransit;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.iitp.iitp_rest.model.common.DbMappedEnum;

import java.util.stream.Stream;

public enum TransitMode implements DbMappedEnum<String> {

    subway("subway"),
    bus("bus");

    private final String value;

    TransitMode(String value) {
        this.value = value;
    }

    @Override
    public String getValue() {
        return this.value;
    }

    @JsonCreator
    public static TransitMode fromValue(String value) {
        return Stream.of(TransitMode.values())
                .filter(type -> type.getValue().equals(value))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unsupported value: " + value));
    }
}