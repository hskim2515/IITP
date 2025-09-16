package com.iitp.iitp_rest.model.schema;


import com.fasterxml.jackson.annotation.JsonCreator;
import com.iitp.iitp_rest.mapper.DbMappedEnum;

public enum Status implements DbMappedEnum<String> {

    ACTIVE("ACTIVE"),
    INACTIVE("INACTIVE"),
    DELETED("DELETED");

    private final String value;

    Status(String value) {
        this.value = value;
    }

    @Override
    public String getValue() {
        return this.value;
    }

    @JsonCreator
    public static Status fromValue(String value) {
        return DbMappedEnum.fromValue(Status.class, value);
    }
}