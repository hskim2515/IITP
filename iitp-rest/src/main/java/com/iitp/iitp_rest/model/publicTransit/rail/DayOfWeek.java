package com.iitp.iitp_rest.model.publicTransit.rail;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.iitp.iitp_rest.model.common.DbMappedEnum;

import java.util.stream.Stream;

public enum DayOfWeek implements DbMappedEnum<String> {

    weekday("weekday"), // 정의서 - weekdays
    weekend("weekend"); // 정의서 - weekends

    private final String value;

    DayOfWeek(String value) {
        this.value = value;
    }

    @Override
    public String getValue() {
        return this.value;
    }

    @JsonCreator
    public static DayOfWeek fromValue(String value) {
        return Stream.of(DayOfWeek.values())
                .filter(type -> type.getValue().equals(value))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unsupported value: " + value));
    }
}