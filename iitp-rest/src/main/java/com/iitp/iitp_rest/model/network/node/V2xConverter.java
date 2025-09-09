package com.iitp.iitp_rest.model.network.node;

import com.iitp.iitp_rest.model.converter.AbstractEnumConverter;
import jakarta.persistence.Converter;

@Converter(autoApply = true)
public class V2xConverter extends AbstractEnumConverter<V2x, String> {
    public V2xConverter() {super(V2x.class);}
}
