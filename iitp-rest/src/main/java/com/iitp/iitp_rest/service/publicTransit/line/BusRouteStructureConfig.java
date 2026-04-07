package com.iitp.iitp_rest.service.publicTransit.line;

import com.iitp.iitp_rest.model.publicTransit.bus.BusPtLinesXml;
import com.iitp.iitp_rest.schema.SchemaStructureRegistration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

@Configuration
public class BusRouteStructureConfig {

    @Bean
    public SchemaStructureRegistration busRouteSchemaStructure() {
        return new SchemaStructureRegistration() {
            @Override
            public String getName() {
                return "busRoute";
            }

            @Override
            public Class<?> getScanEntryPointClass() {
                return BusPtLinesXml.class;
            }

            @Override
            public List<String> getRootSchemaNames() {
                return List.of("lines");
            }
        };
    }

    @Bean
    public SchemaStructureRegistration busRouteWeekdaySchemaStructure() {
        return new SchemaStructureRegistration() {
            @Override
            public String getName() {
                return "busRouteWeekday";
            }

            @Override
            public Class<?> getScanEntryPointClass() {
                return BusPtLinesXml.class;
            }

            @Override
            public List<String> getRootSchemaNames() {
                return List.of("lines");
            }
        };
    }

    @Bean
    public SchemaStructureRegistration busRouteWeekendSchemaStructure() {
        return new SchemaStructureRegistration() {
            @Override
            public String getName() {
                return "busRouteWeekend";
            }

            @Override
            public Class<?> getScanEntryPointClass() {
                return BusPtLinesXml.class;
            }

            @Override
            public List<String> getRootSchemaNames() {
                return List.of("lines");
            }
        };
    }
}
