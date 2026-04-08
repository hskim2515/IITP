package com.iitp.iitp_rest.model.publicTransit;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import com.iitp.iitp_rest.mapper.DbMappedEnum;

public enum TransitMode implements DbMappedEnum<String> {

    subway("subway"),
    bus("bus");

    private final String value;

    TransitMode(String value) {
        this.value = value;
    }

    @Override
    @JsonValue
    public String getValue() {
        return this.value;
    }

    @JsonCreator
    public static TransitMode fromValue(String value) {
        return DbMappedEnum.fromValue(TransitMode.class, value);
    }
}