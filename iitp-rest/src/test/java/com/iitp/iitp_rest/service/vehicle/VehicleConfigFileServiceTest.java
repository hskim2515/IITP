package com.iitp.iitp_rest.service.vehicle;

import com.iitp.iitp_rest.util.FileStorageService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class VehicleConfigFileServiceTest {

    @Test
    void missingVersionFilesLoadSixNextSimDefaultsWithoutDatabase() throws Exception {
        MemoryStorage storage = new MemoryStorage();
        VehicleConfigFileService service = new VehicleConfigFileService(storage);

        VehicleConfigFileService.VehicleConfiguration configuration = service.load("SCENARIO_TEST_V1");

        assertThat(configuration.vehicleTypes()).hasSize(6);
        assertThat(configuration.vehicleTypes())
                .extracting(VehicleConfigFileService.VehicleTypeData::canonicalName)
                .containsExactly("NormalVeh", "AutonomousVeh", "Truck", "NormalBus", "AutonomousBus", "TRT");
        assertThat(configuration.vehicleTypes().getFirst().parameters().get("veh_width").mean())
                .isEqualTo("1.9");
        assertThat(configuration.vehicleModels()).isEmpty();
    }

    @Test
    void saveWritesVehicleTypesManifestAndGlbUnderVersionDirectory() throws Exception {
        MemoryStorage storage = new MemoryStorage();
        VehicleConfigFileService service = new VehicleConfigFileService(storage);
        VehicleConfigFileService.VehicleTypeData original = service.load("SCENARIO_TEST_V1")
                .vehicleTypes().getFirst();
        Map<String, VehicleConfigFileService.ParameterData> parameters =
                new LinkedHashMap<>(original.parameters());
        parameters.put("veh_len", new VehicleConfigFileService.ParameterData(
                "5.2", "0.5", "4.5", "5.5", "normal"));
        VehicleConfigFileService.VehicleTypeData edited =
                new VehicleConfigFileService.VehicleTypeData(
                        original.id(), original.key(), original.vehicleId(), "테스트 승용차",
                        original.canonicalName(), original.v2x(), original.drt(), original.maxPax(),
                        original.nextsimTypeCode(), false, parameters);
        VehicleConfigFileService.VehicleModelData model =
                new VehicleConfigFileService.VehicleModelData(
                        original.id(), original.key(), "승용차 모델", "#123456", "5.2",
                        null, null, original.id(), original.key(),
                        "{\"heading\":0,\"pitch\":0,\"roll\":1.57}", 0.3);
        var request = new VehicleConfigFileService.SaveRequest(
                original.key(), edited, model, false);
        var file = new MockMultipartFile(
                "file", "car.glb", "model/gltf-binary", new byte[]{1, 2, 3});

        VehicleConfigFileService.VehicleConfiguration saved =
                service.save("SCENARIO_TEST_V1", request, file);

        assertThat(storage.exists("SCENARIO_TEST_V1/vehicletypes.xml")).isTrue();
        assertThat(storage.exists("SCENARIO_TEST_V1/visualization/vehicleModels.xml")).isTrue();
        assertThat(storage.exists("SCENARIO_TEST_V1/visualization/models/NormalVeh_car.glb")).isTrue();
        String xml = new String(
                storage.readFile("SCENARIO_TEST_V1/vehicletypes.xml"),
                StandardCharsets.UTF_8);
        assertThat(xml).contains("name=\"NormalVeh\"").contains("mean=\"5.2\"");
        assertThat(saved.vehicleTypes().getFirst().name()).isEqualTo("테스트 승용차");
        assertThat(saved.vehicleModels().getFirst().filePath())
                .isEqualTo("/vehicle-config/SCENARIO_TEST_V1/models/NormalVeh_car.glb");
    }

    private static final class MemoryStorage implements FileStorageService {
        private final Map<String, byte[]> files = new LinkedHashMap<>();

        @Override
        public void uploadFile(InputStream inputStream, String subDir, String fileName) throws IOException {
            files.put(subDir + "/" + fileName, read(inputStream));
        }

        @Override
        public void uploadFile(InputStream inputStream, String fileName) throws IOException {
            files.put(fileName, read(inputStream));
        }

        @Override
        public void createDirectory(String subDir) {}

        @Override
        public void deleteFile(String fileName) {
            files.remove(fileName);
        }

        @Override
        public void deleteDirectory(String subDir) {
            files.keySet().removeIf(path -> path.startsWith(subDir + "/"));
        }

        @Override
        public byte[] readFile(String fileName) throws IOException {
            byte[] bytes = files.get(fileName);
            if (bytes == null) throw new IOException("missing: " + fileName);
            return bytes;
        }

        @Override
        public boolean exists(String fileName) {
            return files.containsKey(fileName);
        }

        private static byte[] read(InputStream inputStream) throws IOException {
            try (inputStream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                inputStream.transferTo(output);
                return output.toByteArray();
            }
        }
    }
}
