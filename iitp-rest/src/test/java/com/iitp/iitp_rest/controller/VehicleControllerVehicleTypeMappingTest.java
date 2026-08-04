package com.iitp.iitp_rest.controller;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class VehicleControllerVehicleTypeMappingTest {

    @Test
    void preservesNextSimNvAndAvCodesWithoutDatabaseRows() {
        Map<String, String> onlyNvRegistered = Map.of("NV", "NV");

        assertThat(VehicleController.resolveVehicleType("1", "NV", onlyNvRegistered))
                .isEqualTo("NV");
        assertThat(VehicleController.resolveVehicleType("2", "AV", onlyNvRegistered))
                .isEqualTo("AV");
    }

    @Test
    void usesDatabaseMappingForCustomVehicleCodes() {
        assertThat(VehicleController.resolveVehicleType(
                "3", "TAXI_CODE", Map.of("TAXI_CODE", "TAXI")))
                .isEqualTo("TAXI");
    }

    @Test
    void returnsUnclassifiedForUnknownOrMissingCodes() {
        assertThat(VehicleController.resolveVehicleType("4", "UNKNOWN", Map.of()))
                .isEqualTo("UNCLASSIFIED");
        assertThat(VehicleController.resolveVehicleType("5", null, Map.of()))
                .isEqualTo("UNCLASSIFIED");
    }
}
