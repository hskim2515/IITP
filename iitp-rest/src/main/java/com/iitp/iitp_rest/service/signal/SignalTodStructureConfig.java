package com.iitp.iitp_rest.service.signal;

import com.iitp.iitp_rest.model.signal.SignalTodXml;
import com.iitp.iitp_rest.schema.SchemaStructureRegistration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class SignalTodStructureConfig {

    @Bean
    public SchemaStructureRegistration signalTodSchemaStructure() {
        return new SchemaStructureRegistration() {
            @Override
            public String getName() {
                return "signalTod";
            }

            @Override
            public Class<?> getScanEntryPointClass() {
                return SignalTodXml.class;
            }

            @Override
            public List<String> getRootSchemaNames() {
                return List.of("nodes");
            }
        };
    }
}
