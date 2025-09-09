package com.iitp.iitp_rest.model.publicTransit.rail;

import com.iitp.iitp_rest.model.converter.AbstractEnumConverter;
import jakarta.persistence.Converter;

@Converter(autoApply = true)
public class DayOfWeekConverter extends AbstractEnumConverter<DayOfWeek, String> {
    public DayOfWeekConverter() {
        super(DayOfWeek.class);
    }
}
