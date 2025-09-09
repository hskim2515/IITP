package com.iitp.iitp_rest.model.network.link;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.iitp.iitp_rest.model.common.DbMappedEnum;
import lombok.Getter;

import java.util.stream.Stream;

@Getter
public enum SimType implements DbMappedEnum<Integer> {
    Meso(0),
    Micro(1);

    private final int value;

    SimType(int value) {
        this.value = value;
    }
    @Override
    public Integer getValue() {
        return this.value;
    }

    @JsonCreator
    public static SimType fromValue(int value) {
        return Stream.of(SimType.values())
                .filter(type -> type.getValue().equals(value))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unsupported value: " + value));
    }
}
