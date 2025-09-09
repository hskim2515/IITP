package com.iitp.iitp_rest.model.network.node;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.iitp.iitp_rest.model.common.DbMappedEnum;
import lombok.Getter;

import java.util.stream.Stream;

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
        return Stream.of(V2x.values())
                .filter(type -> type.getValue().equals(value))
                .findFirst()
                .orElse(V2x.off);
    }
}
