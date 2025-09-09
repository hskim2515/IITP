package com.iitp.iitp_rest.model.converter;

import java.util.stream.Stream;

import com.iitp.iitp_rest.model.common.DbMappedEnum;
import jakarta.persistence.AttributeConverter;

public abstract class AbstractEnumConverter<E extends Enum<E> & DbMappedEnum<T>, T> implements AttributeConverter<E, T> {

    private final Class<E> clazz;

    public AbstractEnumConverter(Class<E> clazz) {
        this.clazz = clazz;
    }
    @Override
    public T convertToDatabaseColumn(E attribute) {
        return attribute == null ? null : attribute.getValue();
    }

    @Override
    public E convertToEntityAttribute(T dbData) {
        if (dbData == null) {
            return null;
        }
        return Stream.of(clazz.getEnumConstants())
                .filter(e -> e.getValue().equals(dbData))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unsupported value for " + clazz.getSimpleName() + ": " + dbData));
    }
}