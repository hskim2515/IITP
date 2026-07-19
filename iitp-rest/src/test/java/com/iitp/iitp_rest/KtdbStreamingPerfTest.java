package com.iitp.iitp_rest;

import com.iitp.iitp_rest.service.network.KtdbStreamingConverter;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import java.lang.management.ManagementFactory;
import java.lang.management.MemoryMXBean;

/**
 * KtdbStreamingConverter 성능 테스트.
 * 실제 DB 연결 필요 (localhost:5432/iitp).
 *
 * 실행: ./gradlew test --tests "com.iitp.iitp_rest.KtdbStreamingPerfTest"
 */
@SpringBootTest
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class KtdbStreamingPerfTest {

    @Autowired
    private KtdbStreamingConverter streamingConverter;

    private static final MemoryMXBean MEM = ManagementFactory.getMemoryMXBean();

    // ── 테스트 케이스별 bbox ──────────────────────────────────────────────────

    /** 소형: 강남구 일대 (~5km²) */
    private static final double[] SMALL = {37.49, 127.01, 37.54, 127.07};

    /** 중형: 서울시 전체 (~600km²) */
    private static final double[] SEOUL = {37.43, 126.78, 37.70, 127.18};

    /** 대형: 수도권 광역 (~8,000km²) - 원래 오류 발생 케이스 */
    private static final double[] METRO = {37.23, 126.58, 37.69, 127.21};

    /** 전국 */
    private static final double[] NATION = {33.1, 125.9, 38.6, 130.9};

    // ── 테스트 ────────────────────────────────────────────────────────────────

    @Test @Order(1)
    void small_bbox() throws Exception {
        run("소형 (강남구)", SMALL);
    }

    @Test @Order(2)
    void seoul_bbox() throws Exception {
        run("중형 (서울시)", SEOUL);
    }

    @Test @Order(3)
    void metro_bbox() throws Exception {
        run("대형 (수도권 광역)", METRO);
    }

    @Test @Order(4)
    void nationwide() throws Exception {
        run("전국", NATION);
    }

    // ── 공통 실행 ─────────────────────────────────────────────────────────────

    private void run(String label, double[] bbox) throws Exception {
        double south = bbox[0], west = bbox[1], north = bbox[2], east = bbox[3];
        double baseLat = (south + north) / 2.0;
        double baseLon = (west  + east)  / 2.0;
        double areaDeg = (north - south) * (east - west);
        boolean isLarge = KtdbStreamingConverter.LARGE_BBOX_THRESHOLD < areaDeg;

        System.gc();
        long memBefore = heapMB();
        long t0 = System.currentTimeMillis();

        KtdbStreamingConverter.StreamResult result =
                streamingConverter.streamConvert(south, west, north, east,
                        baseLat, baseLon, 0, null);  // versionId=null → SFTP 업로드 없음

        long elapsedMs = System.currentTimeMillis() - t0;
        System.gc();
        long memAfter = heapMB();

        System.out.printf("%n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%n");
        System.out.printf("  %s  [%s]%n", label, isLarge ? "스트리밍" : "기존");
        System.out.printf("  bbox 면적: %.4f°² (%.0f km²)%n", areaDeg, areaDeg * 111 * 88);
        System.out.printf("  ├ 처리 시간: %,d ms  (%.1f 초)%n", elapsedMs, elapsedMs / 1000.0);
        System.out.printf("  ├ 노드 수:   %,d%n", result.nodeCount());
        System.out.printf("  ├ 링크 수:   %,d%n", result.linkCount());
        System.out.printf("  └ 힙 사용:   %+d MB  (%d MB → %d MB)%n",
                memAfter - memBefore, memBefore, memAfter);
        System.out.printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%n");
    }

    private long heapMB() {
        return MEM.getHeapMemoryUsage().getUsed() / 1_000_000;
    }
}
