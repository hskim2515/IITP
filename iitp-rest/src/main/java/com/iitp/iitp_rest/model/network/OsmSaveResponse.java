package com.iitp.iitp_rest.model.network;

import java.util.List;

public record OsmSaveResponse(
        NetworkResponse network,
        List<String> warnings,
        List<String> errors
) {
    /** 하위 호환: 기존 호출부 (errors 없이 생성) */
    public OsmSaveResponse(NetworkResponse network, List<String> warnings) {
        this(network, warnings, List.of());
    }
}
