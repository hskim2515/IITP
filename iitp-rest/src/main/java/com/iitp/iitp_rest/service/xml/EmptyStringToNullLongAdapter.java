package com.iitp.iitp_rest.service.xml;

import jakarta.xml.bind.annotation.adapters.XmlAdapter;

/**
 * XML의 빈 문자열("") 속성을 Long 타입의 null로 변환
 */
public class EmptyStringToNullLongAdapter extends XmlAdapter<String, Long> {

    @Override
    public Long unmarshal(String v) throws Exception {
        if (v == null || v.trim().isEmpty()) {
            return null;
        }
        return Long.parseLong(v);
    }

    @Override
    public String marshal(Long v) throws Exception {
        if (v == null) {
            return null;
        }
        return v.toString();
    }
}