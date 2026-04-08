package com.iitp.iitp_rest.service.xmllayer;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Map;

/**
 * JAXB 객체 ↔ Map<String,Object> 변환 유틸.
 * ObjectMapper가 JAXB 어노테이션을 무시하고 필드 기준으로 직렬화한다.
 */
public final class XmlLayerConverter {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private XmlLayerConverter() {}

    /** JAXB Xml 객체 → Map (DB 저장용) */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> toMap(Object xmlObj) {
        return MAPPER.convertValue(xmlObj, Map.class);
    }

    /** Map → 특정 클래스 (DB 조회 후 복원용, 필요 시 사용) */
    public static <T> T fromMap(Map<String, Object> map, Class<T> clazz) {
        return MAPPER.convertValue(map, clazz);
    }
}
