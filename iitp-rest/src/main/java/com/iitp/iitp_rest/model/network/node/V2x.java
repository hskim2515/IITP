package com.iitp.iitp_rest.model.network.node;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.iitp.iitp_rest.mapper.DbMappedEnum;
import lombok.Getter;

@Getter
public enum V2x implements DbMappedEnum<String> {
    on("on"),
    off("off");
    private final String value;

    V2x(String value) {
        this.value = value;
    }

    @Override
    public String getValue() {
        return this.value;
    }

    @JsonCreator
    public static V2x fromValue(String value) {
        return DbMappedEnum.fromValue(V2x.class, value);
    }
}
