package com.iitp.iitp_rest.model.publicTransit.rail;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.iitp.iitp_rest.mapper.DbMappedEnum;

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
        return DbMappedEnum.fromValue(DayOfWeek.class, value);
    }
}