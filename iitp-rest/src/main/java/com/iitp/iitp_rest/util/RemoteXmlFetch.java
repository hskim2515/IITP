package com.iitp.iitp_rest.util;

import java.io.IOException;
import java.io.InputStream;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.URLConnection;

/**
 * 원격 모델 파일 서버(gaia3d 등)에서 network.xml/signal.xml 등을 읽는 공용 헬퍼.
 *
 * <p>기존엔 각 서비스가 {@code new URL(path).openStream()}을 직접 호출했는데, 이 방식은
 * 연결/응답 타임아웃이 없어 원격 서버가 느리거나 무응답이면 요청 스레드가 무한 대기한다.
 * 프론트엔드 axios 도 타임아웃이 없어, 이 상태가 그대로 "버전 선택 후 스피너만 계속 도는"
 * 증상으로 이어졌다(개발서버 재현 보고). 타임아웃을 걸어 실패를 빠르게 드러낸다.
 */
public final class RemoteXmlFetch {

    private static final int CONNECT_TIMEOUT_MS = 8_000;
    private static final int READ_TIMEOUT_MS    = 20_000;

    private RemoteXmlFetch() {}

    /** path 에서 InputStream 오픈 (타임아웃 적용). 응답 지연/무응답 시 명확한 IOException. */
    public static InputStream openStream(String path) throws IOException {
        URLConnection conn = new URL(path).openConnection();
        conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
        conn.setReadTimeout(READ_TIMEOUT_MS);
        try {
            return conn.getInputStream();
        } catch (SocketTimeoutException e) {
            throw new IOException("원격 파일 서버 응답 지연/무응답 (" +
                    CONNECT_TIMEOUT_MS + "ms 연결/" + READ_TIMEOUT_MS + "ms 읽기 타임아웃): " + path, e);
        }
    }
}
