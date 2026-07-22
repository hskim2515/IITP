package com.iitp.iitp_rest;

import com.iitp.iitp_rest.service.network.NetworkIdAssigner;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/**
 * {@link NetworkIdAssigner} 단독 검증 — Network ID naming 규칙(Link=2, Node=1(10=일반/
 * 11=터미널), 뒷자리 3자리 매칭)의 핵심 로직이 모든 호출부(KTDB/OSM/SUMO 변환기,
 * NetworkIdNormalizer, OdTerminalIdBandService)에 공유되므로, 여기서 충돌·대규모·경계
 * 케이스를 철저히 검증하면 그 6곳 전부의 안전성을 한 번에 보장한다.
 *
 * <p>최종 목표(사용자 요청): NextSim route-generator가 터미널/일반 노드 id 대역 불일치로
 * 크래시하는 걸 막는 것 — 즉 이 테스트들의 핵심 불변조건은 "모든 파생 id가 유일하고,
 * 항상 올바른 대역(11xxxxxx)에 속한다"이다.
 */
class NetworkIdAssignerTest {

    @Test
    void terminalIdFor_matchesLastThreeDigitsOfPairedLink() {
        NetworkIdAssigner a = new NetworkIdAssigner();
        assertEquals(11_000_326L, a.terminalIdFor(20_000_326L));
        assertEquals(11_000_001L, a.terminalIdFor(20_000_001L));
        assertEquals(11_000_000L, a.terminalIdFor(20_001_000L), "뒷자리 3자리가 000이면 접미사 없음");
    }

    @Test
    void terminalIdFor_doesNotMatchBeyondThreeDigits() {
        NetworkIdAssigner a = new NetworkIdAssigner();
        long linkId = 20_001_326L; // 뒷자리 3자리=326, 6자리=001326
        long termId = a.terminalIdFor(linkId);
        assertEquals(11_000_326L, termId, "3자리만 반영 — 001326 전체가 아니라 326만");
        assertNotEquals(11_001_326L, termId);
    }

    @Test
    void terminalIdFor_collidingSuffix_fallsBackToIsolated_noDuplicate() {
        NetworkIdAssigner a = new NetworkIdAssigner();
        // 뒷자리 3자리가 동일한 서로 다른 두 링크 (실제로 존재 가능 — 카운터가 1000 넘으면 흔함)
        long linkA = 20_000_326L;
        long linkB = 20_001_326L; // linkA와 뒷자리 3자리 동일(326) — 충돌 유발

        long idA = a.terminalIdFor(linkA);
        long idB = a.terminalIdFor(linkB);

        assertEquals(11_000_326L, idA, "먼저 온 쪽은 정상적으로 파생됨");
        assertNotEquals(idA, idB, "충돌 시 서로 다른 id를 가져야 함 — 크래시 방지 핵심 불변조건");
        assertTrue(idB >= 11_000_000L && idB < 12_000_000L, "폴백도 터미널 대역이어야 함: " + idB);
    }

    @Test
    void terminalIdFor_manyCollisionsOnSameSuffix_allUniqueAndBanded() {
        NetworkIdAssigner a = new NetworkIdAssigner();
        Set<Long> produced = new HashSet<>();
        // 뒷자리 3자리가 전부 동일(777)한 링크 50개 — 실제로 대형 네트워크에서 흔히 발생
        for (int i = 0; i < 50; i++) {
            long linkId = 20_000_000L + i * 1000L + 777L; // ..000777, ..001777, ..002777, ...
            long termId = a.terminalIdFor(linkId);
            assertTrue(termId >= 11_000_000L && termId < 12_000_000L,
                    "모든 id는 터미널 대역이어야 함: " + termId);
            assertTrue(produced.add(termId), "중복 id 발생 — 크래시 유발 가능: " + termId);
        }
        assertEquals(50, produced.size());
    }

    @Test
    void terminalIdFor_respectsPreRegisteredExistingIds() {
        NetworkIdAssigner a = new NetworkIdAssigner();
        a.registerExistingTerminalId(11_000_326L); // 이미 실제 네트워크에 존재하는 터미널

        long termId = a.terminalIdFor(20_000_326L); // 뒷자리 동일 → 등록된 기존 id와 충돌
        assertNotEquals(11_000_326L, termId, "이미 존재하는 id와는 충돌해선 안 됨");
        assertTrue(termId >= 11_000_000L && termId < 12_000_000L);
    }

    @Test
    void nextIsolatedTerminalId_neverCollidesWithDerivedTerminalIds() {
        NetworkIdAssigner a = new NetworkIdAssigner();
        Set<Long> produced = new HashSet<>();
        // terminalIdFor로 파생된 id들과 nextIsolatedTerminalId로 배정된 id들이 뒤섞여도
        // (예: 고립 노드 다수 + 뒷자리 매칭 노드 다수) 서로 충돌하면 안 된다.
        for (int i = 0; i < 30; i++) {
            long derived = a.terminalIdFor(20_000_000L + i); // 뒷자리 0..29, 충돌 없음
            assertTrue(produced.add(derived), "파생 id 중복: " + derived);
        }
        for (int i = 0; i < 30; i++) {
            long isolated = a.nextIsolatedTerminalId();
            assertTrue(produced.add(isolated), "고립 순번 id 중복(파생 id와 충돌 가능): " + isolated);
        }
        assertEquals(60, produced.size());
    }

    @Test
    void largeScaleStress_thousandsOfLinksHeavySuffixCollisions_noDuplicateNoCrash() {
        // 실제 대형 네트워크(부천 규모, 수만 링크) 규모를 흉내: 3000개 링크 id를 순차 생성하면
        // 뒷자리 3자리 공간(1000개)을 3배 초과해 충돌이 사실상 필연적으로 발생한다.
        // 목표: 이 정도 규모에서도 예외 없이, 중복 없이, 전부 올바른 대역으로 끝나는지 확인.
        NetworkIdAssigner a = new NetworkIdAssigner();
        Set<Long> produced = new HashSet<>();
        assertDoesNotThrow(() -> {
            for (int i = 0; i < 3000; i++) {
                long linkId = 20_000_000L + i;
                long termId = a.terminalIdFor(linkId);
                assertTrue(termId >= 11_000_000L && termId < 12_000_000L,
                        "id " + i + "가 터미널 대역을 벗어남: " + termId);
                assertTrue(produced.add(termId), "id " + i + "에서 중복 발생: " + termId);
            }
        });
        assertEquals(3000, produced.size(), "3000개 전부 유일해야 함(대역 불일치/중복=NextSim 크래시 원인)");
    }

    @Test
    void bandsNeverOverlap_linkNormalIsolatedTerminal() {
        // 링크/일반노드/고립터미널이 같은 카운터를 공유해도(nextLinkId/nextNormalNodeId/
        // nextIsolatedTerminalId 전부 동일한 counter 필드 사용) 접두사가 달라 최종 id는
        // 절대 겹치지 않아야 한다 — 이게 안 지켜지면 노드와 링크가 같은 id를 갖는 심각한 버그.
        NetworkIdAssigner a = new NetworkIdAssigner();
        Set<Long> allIds = new HashSet<>();
        for (int i = 0; i < 100; i++) {
            assertTrue(allIds.add(a.nextLinkId()));
            assertTrue(allIds.add(a.nextNormalNodeId()));
            assertTrue(allIds.add(a.nextIsolatedTerminalId()));
        }
        assertEquals(300, allIds.size());
        for (long id : allIds) {
            // 링크는 2로 시작(20xxxxxx~29xxxxxx), 일반노드는 10xxxxxx, 터미널은 11xxxxxx
            boolean isLink = id >= 20_000_000L && id < 30_000_000L;
            boolean isNormal = id >= 10_000_000L && id < 11_000_000L;
            boolean isTerminal = id >= 11_000_000L && id < 12_000_000L;
            assertTrue(isLink || isNormal || isTerminal, "예상 대역 밖의 id: " + id);
        }
    }

    @Test
    void startIndexContinuation_avoidsCollidingWithPreExistingIndices() {
        // NetworkIdNormalizer/OdTerminalIdBandService가 기존 최대 인덱스+1부터 이어서
        // 채번할 때 쓰는 생성자 — 이어받은 지점부터 정상적으로 진행되는지 확인.
        NetworkIdAssigner a = new NetworkIdAssigner(1500);
        assertEquals(20_001_500L, a.nextLinkId());
        assertEquals(10_001_501L, a.nextNormalNodeId());
    }
}
