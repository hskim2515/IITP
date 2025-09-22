package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.network.NetworkXml;
import com.iitp.iitp_rest.schema.SchemaStructureRegistration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class NetworkStructureConfig {

    @Bean
    public SchemaStructureRegistration networkSchemaStructure() {
        return new SchemaStructureRegistration() {
            @Override
            public String getName() {
                return "network";
            }

            @Override
            public Class<?> getScanEntryPointClass() {
                return NetworkXml.class;
            }

            @Override
            public List<String> getRootSchemaNames() {
                return List.of("networks");
            }
        };
    }
}
