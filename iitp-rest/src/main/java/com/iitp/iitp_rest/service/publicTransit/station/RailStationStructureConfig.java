package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.model.publicTransit.rail.RailPublicTransitXml;
import com.iitp.iitp_rest.schema.SchemaStructureRegistration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class RailStationStructureConfig {

    @Bean
    public SchemaStructureRegistration railStationSchemaStructure() {
        return new SchemaStructureRegistration() {
            @Override
            public String getName() {
                return "railStation";
            }

            @Override
            public Class<?> getScanEntryPointClass() {
                return RailPublicTransitXml.class;
            }

            @Override
            public List<String> getRootSchemaNames() {
                return List.of("railStations");
            }
        };
    }
}
