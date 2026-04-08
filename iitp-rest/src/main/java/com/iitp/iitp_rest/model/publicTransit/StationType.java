package com.iitp.iitp_rest.model.publicTransit;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import com.iitp.iitp_rest.mapper.DbMappedEnum;

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
    @JsonValue
    public String getValue() {
        return this.value;
    }

    @JsonCreator
    public static StationType fromValue(String value) {
        return DbMappedEnum.fromValue(StationType.class, value);
    }
}