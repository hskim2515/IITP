package com.iitp.iitp_rest.model.role;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.iitp.iitp_rest.mapper.DbMappedEnum;

public enum Role implements DbMappedEnum<String> {

    ROLE_ADMIN("ROLE_ADMIN"),
    ROLE_USER("ROLE_USER");

    private final String value;

    Role(String value) {
        this.value = value;
    }

    @Override
    public String getValue() {
        return this.value;
    }

    @JsonCreator
    public static Role fromValue(String value) {
        return DbMappedEnum.fromValue(Role.class, value);
    }
}