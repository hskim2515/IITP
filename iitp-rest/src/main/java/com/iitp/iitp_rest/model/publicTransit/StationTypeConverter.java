package com.iitp.iitp_rest.model.publicTransit;

import com.iitp.iitp_rest.mapper.AbstractEnumConverter;
import jakarta.persistence.Converter;

@Converter(autoApply = true)
public class StationTypeConverter extends AbstractEnumConverter<StationType, String> {
    public StationTypeConverter() {
        super(StationType.class);
    }
}
