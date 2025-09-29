package com.iitp.iitp_rest.model.role;

import com.iitp.iitp_rest.mapper.AbstractEnumConverter;
import jakarta.persistence.Converter;

@Converter(autoApply = true)
public class RoleConverter extends AbstractEnumConverter<Role, String> {
    public RoleConverter() {
        super(Role.class);
    }
}
