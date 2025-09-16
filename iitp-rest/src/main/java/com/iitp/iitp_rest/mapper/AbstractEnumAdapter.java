package com.iitp.iitp_rest.mapper;


import jakarta.xml.bind.annotation.adapters.XmlAdapter;

import java.util.stream.Stream;

public abstract class AbstractEnumAdapter<E extends Enum<E> & DbMappedEnum<T>, T> extends XmlAdapter<T, E> {

    private final Class<E> enumClass;

    public AbstractEnumAdapter(Class<E> enumClass) {
        this.enumClass = enumClass;
    }

    @Override
    public E unmarshal(T value) {
        if (value == null) {
            return null;
        }
        return Stream.of(enumClass.getEnumConstants())
                .filter(e -> e.getValue().equals(value))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        String.format("Unsupported value '%s' for enum %s", value, enumClass.getSimpleName())
                ));
    }

    @Override
    public T marshal(E value) {
        if (value == null) {
            return null;
        }
        return value.getValue();
    }
}