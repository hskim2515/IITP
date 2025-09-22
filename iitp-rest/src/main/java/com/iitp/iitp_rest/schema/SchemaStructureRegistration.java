package com.iitp.iitp_rest.schema;

import java.util.List;

public interface SchemaStructureRegistration {

    String getName();

    Class<?> getScanEntryPointClass();

    List<String> getRootSchemaNames();
}
