package com.iitp.iitp_rest.service.simulation;

import org.junit.jupiter.api.Test;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.LinkedHashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * 진단 전용 — filterUnreachableDemands가 실제 부천 배포판 데이터에서 odmatrix.xml의 224개
 * demand를 전부(224→0) 제거해버리는 문제를 재현/원인 파악하기 위한 리플렉션 기반 테스트.
 * 운영 코드(NextSimRunner)의 가시성은 건드리지 않는다 — 이 테스트만 private static 메서드를
 * 직접 호출한다. CI 대상 아님, 로컬 참고 데이터에 의존.
 */
class FilterUnreachableDemandsDiagnosticTest {

    private static final String NETWORK_XML =
            "/Users/hskim/Documents/data/1_bucheon network/network_xml_bucheon/network.xml";
    private static final String ODMATRIX_XML =
            "/Users/hskim/Documents/data/1_bucheon network/network_xml_bucheon/odmatrix.xml";

    @Test
    void reproduceZeroDemandBug() throws Exception {
        assumeTrue(Files.exists(Path.of(NETWORK_XML)), "로컬 network.xml 없음 — 스킵");
        assumeTrue(Files.exists(Path.of(ODMATRIX_XML)), "로컬 odmatrix.xml 없음 — 스킵");

        Path tmpDir = Files.createTempDirectory("filterUnreachableDemandsDiag");
        Path netCopy = tmpDir.resolve("network.xml");
        Path odCopy = tmpDir.resolve("odmatrix.xml");
        Files.copy(Path.of(NETWORK_XML), netCopy, StandardCopyOption.REPLACE_EXISTING);
        Files.copy(Path.of(ODMATRIX_XML), odCopy, StandardCopyOption.REPLACE_EXISTING);

        int beforeCount = countOccurrences(Files.readString(odCopy), "<demand");
        System.out.println("[0] 원본 <demand 개수: " + beforeCount);

        // NextSimRunner는 @RequiredArgsConstructor라 필드 전부 null로 생성 — 아래에서 쓰는
        // extractOdNodeIds/injectRequiredNetworkAttrs/filterUnreachableDemands는 인스턴스
        // 필드(fileStorage 등)를 안 쓰므로 null이어도 안전(운영 코드 실제 실행 순서를 그대로 재현).
        Constructor<?> ctor = NextSimRunner.class.getDeclaredConstructors()[0];
        ctor.setAccessible(true);
        Object[] ctorArgs = new Object[ctor.getParameterCount()];
        Object runner = ctor.newInstance(ctorArgs);

        Method extractOdNodeIds = NextSimRunner.class.getDeclaredMethod("extractOdNodeIds", Path.class);
        extractOdNodeIds.setAccessible(true);
        @SuppressWarnings("unchecked")
        Set<String> odNodeIds = (Set<String>) extractOdNodeIds.invoke(null, odCopy);
        System.out.println("[1] extractOdNodeIds 결과 개수: " + odNodeIds.size() + " " + odNodeIds);

        Method injectRequiredNetworkAttrs = NextSimRunner.class.getDeclaredMethod(
                "injectRequiredNetworkAttrs", Path.class, Set.class);
        injectRequiredNetworkAttrs.setAccessible(true);
        injectRequiredNetworkAttrs.invoke(runner, netCopy, odNodeIds);

        String netAfterInject = Files.readString(netCopy);
        int terminalAfter = countOccurrences(netAfterInject, "type=\"terminal\"");
        int garageAfter = countOccurrences(netAfterInject, "type=\"garage\"");
        System.out.println("[2] injectRequiredNetworkAttrs 후 network.xml: terminal=" + terminalAfter + ", garage=" + garageAfter);

        // odNodeIds로 지정된 31개가 실제로 terminal로 남아있는지 직접 확인
        int keptAsTerminal = 0;
        for (String id : odNodeIds) {
            if (netAfterInject.contains("<node id=\"" + id + "\" type=\"terminal\"")) keptAsTerminal++;
        }
        System.out.println("[2b] odNodeIds(" + odNodeIds.size() + "개) 중 실제 terminal로 유지된 것: " + keptAsTerminal);

        Method filterUnreachableDemands = NextSimRunner.class.getDeclaredMethod(
                "filterUnreachableDemands", Path.class, Path.class);
        filterUnreachableDemands.setAccessible(true);
        filterUnreachableDemands.invoke(null, netCopy, odCopy);

        int afterCount = countOccurrences(Files.readString(odCopy), "<demand");
        System.out.println("[3] filterUnreachableDemands 후 <demand 개수: " + afterCount);
    }

    private static int countOccurrences(String s, String sub) {
        int count = 0, idx = 0;
        while ((idx = s.indexOf(sub, idx)) != -1) {
            count++;
            idx += sub.length();
        }
        return count;
    }
}
