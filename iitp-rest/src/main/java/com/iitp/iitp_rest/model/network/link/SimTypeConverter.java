package com.iitp.iitp_rest.model.network.link;

import com.iitp.iitp_rest.mapper.AbstractEnumConverter;
import jakarta.persistence.Converter;

@Converter(autoApply = true)
public class SimTypeConverter extends AbstractEnumConverter<SimType, Integer> {
    public SimTypeConverter() {
        super(SimType.class);
    }
}
