package com.iitp.iitp_rest.service.network;

import java.util.HashSet;
import java.util.Set;

/**
 * NextSim 네트워크 ID 채번 규칙(스펙 "Network ID naming") 공용 유틸리티.
 *
 * <p>Link=2, Node(교차로)=1, Terminal(차량 출입점)=11 로 시작하는 8자리 숫자이며,
 * Terminal은 연결된 단 하나의 Link와 뒷자리 3자리가 동일해야 한다(예: Link 20000326 ↔
 * Terminal 11000326). Link와 (Terminal이 아닌) 일반 Node는 생성 순서에 따라 하나의
 * 인덱스를 공유한다 — 링크를 원본 순서대로 스캔하며 링크 ID를 배정하고, 그 링크의
 * endpoint 노드를 처음 볼 때 바로 이어서 배정하면 이 두 규칙을 한 번의 스캔으로 만족한다.
 *
 * <p>Terminal은 파생값(페어링된 Link의 뒷자리 3자리)이므로 공유 카운터를 소비하지 않는다.
 * 단, 뒷자리 3자리만 보므로 서로 다른 두 Link가 우연히 뒷자리 3자리가 같으면(1000개 중
 * 하나 확률) 파생 Terminal id가 충돌할 수 있다 — {@link #terminalIdFor(long)}가 이미
 * 사용된 id를 추적해 충돌 시 자동으로 {@link #nextIsolatedTerminalId()} 순번 배정으로
 * 폴백한다. 어느 Link에도 연결되지 않은 고립 노드(0-degree, 비정상 데이터)도 페어링할
 * Link가 없어 같은 fallback을 쓴다.
 */
public final class NetworkIdAssigner {

    private long counter;
    private final Set<Long> usedTerminalIds = new HashSet<>();

    public NetworkIdAssigner() {
        this(1);
    }

    /** 기존에 이미 채번된 최대 인덱스 이후부터 이어서 채번할 때 사용(예: 수동 편집 diff 정규화). */
    public NetworkIdAssigner(long startIndex) {
        this.counter = startIndex;
    }

    public long nextLinkId() {
        return 20_000_000L + counter++;
    }

    public long nextNormalNodeId() {
        return 10_000_000L + counter++;
    }

    /**
     * 기존 데이터(재배정 시나리오 등)에 이미 존재하는 터미널 id를 미리 등록해둔다 —
     * 등록해두지 않으면 이번에 새로 파생시키는 터미널 id가 기존의 실제 터미널 id와
     * 충돌해도 감지하지 못한다.
     */
    public void registerExistingTerminalId(long id) {
        usedTerminalIds.add(id);
    }

    /**
     * Terminal은 연결된 단 하나의 Link와 뒷자리 3자리가 동일해야 한다(예: Link 20000326 ↔
     * Terminal 11000326). 다른 Link와 뒷자리 3자리가 우연히 같아 이미 사용 중인 id면
     * {@link #nextIsolatedTerminalId()}로 폴백해 충돌을 피한다.
     */
    public long terminalIdFor(long pairedLinkId) {
        long candidate = 11_000_000L + (pairedLinkId % 1_000L);
        if (usedTerminalIds.contains(candidate)) {
            return nextIsolatedTerminalId();
        }
        usedTerminalIds.add(candidate);
        return candidate;
    }

    public long nextIsolatedTerminalId() {
        long id = 11_000_000L + counter++;
        while (usedTerminalIds.contains(id)) id = 11_000_000L + counter++;
        usedTerminalIds.add(id);
        return id;
    }
}
