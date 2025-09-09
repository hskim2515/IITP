package com.iitp.iitp_rest.model.publicTransit;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.iitp.iitp_rest.model.common.DbMappedEnum;

import java.util.stream.Stream;

public enum StationType implements DbMappedEnum<String> {

    island("island"),
    side("side"),
    face_to_face("face-to-face"),
    staggered("staggered");

    private final String value;

    StationType(String value) {
        this.value = value;
    }

    @Override
    public String getValue() {
        return this.value;
    }

    @JsonCreator
    public static StationType fromValue(String value) {
        return Stream.of(StationType.values())
                .filter(type -> type.getValue().equals(value))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unsupported value: " + value));
    }
}