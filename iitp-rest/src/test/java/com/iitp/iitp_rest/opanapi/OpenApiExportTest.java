package com.iitp.iitp_rest.opanapi;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.servers.Server;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;


@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@AutoConfigureMockMvc
@ActiveProfiles("openapi")
class OpenApiExportTest {

    @Autowired
    MockMvc mockMvc;

    @TestConfiguration
    static class TestOpenApiConfig {
        @Bean
        public OpenAPI customOpenAPI() {
            Server server = new Server();
            server.setUrl("http://localhost:8080");
            return new OpenAPI().servers(List.of(server));
        }
    }

    @Test
    void exportOpenApi() throws Exception {
        var res = mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andReturn();

        String json = res.getResponse().getContentAsString(StandardCharsets.UTF_8);
        String outDirProp = System.getProperty("openapi.outputDir",
                Path.of("").toAbsolutePath().getParent().resolve("api-specs").toString());

        Path outDir = Path.of(outDirProp);
        Files.createDirectories(outDir);
        Files.writeString(outDir.resolve("openapi.json"), json, StandardCharsets.UTF_8);

    }
}
