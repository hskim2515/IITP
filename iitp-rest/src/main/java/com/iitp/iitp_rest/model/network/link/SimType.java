package com.iitp.iitp_rest.model.network.link;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.iitp.iitp_rest.mapper.DbMappedEnum;
import lombok.Getter;

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
        return DbMappedEnum.fromValue(SimType.class, value);
    }
}
