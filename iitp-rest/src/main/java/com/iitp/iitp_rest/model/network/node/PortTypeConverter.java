package com.iitp.iitp_rest.model.network.node;

import com.iitp.iitp_rest.model.converter.AbstractEnumConverter;
import jakarta.persistence.Converter;

@Converter(autoApply = true)
public class PortTypeConverter extends AbstractEnumConverter<PortType, String> {
    public PortTypeConverter() {
        super(PortType.class);
    }
}
