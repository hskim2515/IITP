package com.iitp.iitp_rest.service.publicTransit.line;

import com.iitp.iitp_rest.model.publicTransit.rail.RailPtLineXml;
import com.iitp.iitp_rest.schema.SchemaStructureRegistration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class RailRouteStructureConfig {

    @Bean
    public SchemaStructureRegistration railRouteSchemaStructure() {
        return new SchemaStructureRegistration() {
            @Override
            public String getName() {
                return "railRoute";
            }

            @Override
            public Class<?> getScanEntryPointClass() {
                return RailPtLineXml.class;
            }

            @Override
            public List<String> getRootSchemaNames() {
                return List.of("routes");
            }
        };
    }
}
