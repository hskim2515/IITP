package com.iitp.iitp_rest.mapper;

import jakarta.persistence.AttributeConverter;

import java.util.Arrays;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

public abstract class AbstractEnumConverter<E extends Enum<E> & DbMappedEnum<T>, T>
        implements AttributeConverter<E, T> {

    private final Class<E> clazz;
    private final Map<T, E> index;

    protected AbstractEnumConverter(Class<E> clazz) {
        this.clazz = clazz;
        this.index = Arrays.stream(clazz.getEnumConstants())
                .collect(Collectors.toUnmodifiableMap(E::getValue, Function.identity()));
    }

    @Override
    public T convertToDatabaseColumn(E attribute) {
        return attribute == null ? null : attribute.getValue();
    }

    @Override
    public E convertToEntityAttribute(T dbData) {
        if (dbData == null) return null;
        E e = index.get(dbData);
        if (e != null) return e;
        // 혹시 캐시에 없으면(데이터 불일치 등) 마지막 방어
        throw new IllegalArgumentException(
                "Unsupported value '" + dbData + "' for " + clazz.getSimpleName());
    }
}
