package com.iitp.iitp_rest.model.common;

public interface DbMappedEnum<T> {
    T getValue(); // DB에 저장될 값을 반환하는 메서드
}