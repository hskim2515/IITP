package com.iitp.iitp_rest.service.publicTransit.station;

import com.iitp.iitp_rest.model.publicTransit.bus.PublicTransitXml;
import com.iitp.iitp_rest.schema.SchemaStructureRegistration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class BusStationStructureConfig {

    @Bean
    public SchemaStructureRegistration busStationSchemaStructure() {
        return new SchemaStructureRegistration() {
            @Override
            public String getName() {
                return "busStation";
            }

            @Override
            public Class<?> getScanEntryPointClass() {
                return PublicTransitXml.class;
            }

            @Override
            public List<String> getRootSchemaNames() {
                return List.of("busStations");
            }
        };
    }
}
