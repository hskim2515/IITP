package com.iitp.iitp_rest.model.network.connection;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.iitp.iitp_rest.model.common.DbMappedEnum;
import lombok.Getter;

import java.util.stream.Stream;

@Getter
public enum Turning implements DbMappedEnum<String> {

    Straight("S"),
    Right_Turn("R"),
    Left_Turn("L");

    private final String value;

    Turning(String value) {
        this.value = value;
    }

    @Override
    public String getValue() {
        return this.value;
    }

    @JsonCreator
    public static Turning fromValue(String value) {
        return Stream.of(Turning.values())
                .filter(type -> type.getValue().equals(value))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unsupported value: " + value));
    }
}