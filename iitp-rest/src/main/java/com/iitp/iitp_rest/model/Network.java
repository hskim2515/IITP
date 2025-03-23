package com.iitp.iitp_rest.model;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.*;
import lombok.Data;

@Entity
@Data
public class Network {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;

    // GeoJSON을 저장할 때 String으로 변환하여 저장
    @Column(columnDefinition = "TEXT")
    private String geojson; // GeoJSON 데이터를 문자열로 저장

    public JsonNode getGeojson() {
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            return objectMapper.readTree(geojson); // GeoJSON 문자열을 JsonNode로 변환
        } catch (Exception e) {
            return null;
        }
    }

    public void setGeojson(JsonNode geojson) {
        try {
            ObjectMapper objectMapper = new ObjectMapper();
            this.geojson = objectMapper.writeValueAsString(geojson); // JsonNode를 문자열로 변환하여 저장
        } catch (Exception e) {
            this.geojson = null;
        }
    }

}
