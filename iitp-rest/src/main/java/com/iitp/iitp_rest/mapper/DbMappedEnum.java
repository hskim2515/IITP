package com.iitp.iitp_rest.mapper;

import com.fasterxml.jackson.annotation.JsonValue;
import java.util.Objects;

public interface DbMappedEnum<T> {

    @JsonValue
    T getValue(); // DB에 저장될 값을 반환하는 메서드

    static <E extends Enum<E> & DbMappedEnum<V>, V> E fromValue(Class<E> type, V value) {
        for (E e : type.getEnumConstants()) if (Objects.equals(e.getValue(), value)) return e;
        throw new IllegalArgumentException("Unsupported value: " + value + " for " + type.getSimpleName());
    }
}