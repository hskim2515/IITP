package com.iitp.iitp_rest.model.publicTransit;

import com.iitp.iitp_rest.model.converter.AbstractEnumConverter;
import jakarta.persistence.Converter;

@Converter(autoApply = true)
public class TransitModeConverter extends AbstractEnumConverter<TransitMode, String> {
    public TransitModeConverter() {
        super(TransitMode.class);
    }
}
