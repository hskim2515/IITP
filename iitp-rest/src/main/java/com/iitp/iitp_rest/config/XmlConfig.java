package com.iitp.iitp_rest.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.xml.stream.XMLInputFactory;

@Configuration
public class XmlConfig {
    @Bean
    public XMLInputFactory xmlInputFactory() {
        return XMLInputFactory.newInstance();
    }
}
