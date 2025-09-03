package com.iitp.iitp_rest.model.network.node;

import com.iitp.iitp_rest.model.converter.AbstractEnumConverter;
import jakarta.persistence.Converter;

@Converter(autoApply = true)
public class TurningConverter extends AbstractEnumConverter<Turning, String> {
    public TurningConverter() {
        super(Turning.class);
    }
}
