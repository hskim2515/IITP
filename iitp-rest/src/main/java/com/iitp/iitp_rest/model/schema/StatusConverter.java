package com.iitp.iitp_rest.model.schema;

import com.iitp.iitp_rest.model.converter.AbstractEnumConverter;
import jakarta.persistence.Converter;

@Converter(autoApply = true)
public class StatusConverter extends AbstractEnumConverter<Status, String> {
    public StatusConverter() {
        super(Status.class);
    }
}
