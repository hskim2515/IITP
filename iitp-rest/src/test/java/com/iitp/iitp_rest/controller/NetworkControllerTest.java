package com.iitp.iitp_rest.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class NetworkControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void 네트워크_반환() throws Exception {

        mockMvc.perform(get("/network/scenario1"))
                .andDo(print())
                .andExpect(status().isOk());
    }

}