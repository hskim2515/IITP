package com.iitp.iitp_rest.service.network;

/**
 * NextSim 네트워크 ID 채번 규칙(스펙 "Network ID naming") 공용 유틸리티.
 *
 * <p>Link=2, Node(교차로)=1, Terminal(차량 출입점)=11 로 시작하는 8자리 숫자이며,
 * Terminal은 연결된 단 하나의 Link와 뒷자리 6자리가 동일해야 한다(예: Link 20000326 ↔
 * Terminal 11000326). Link와 (Terminal이 아닌) 일반 Node는 생성 순서에 따라 하나의
 * 인덱스를 공유한다 — 링크를 원본 순서대로 스캔하며 링크 ID를 배정하고, 그 링크의
 * endpoint 노드를 처음 볼 때 바로 이어서 배정하면 이 두 규칙을 한 번의 스캔으로 만족한다.
 *
 * <p>Terminal은 파생값(페어링된 Link의 뒷자리)이므로 공유 카운터를 소비하지 않는다.
 * 어느 Link에도 연결되지 않은 고립 노드(0-degree, 비정상 데이터)는 페어링할 Link가 없어
 * {@link #nextIsolatedTerminalId()}로 공유 카운터를 소비하는 fallback을 쓴다.
 */
public final class NetworkIdAssigner {

    private long counter;

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

    public static long terminalIdFor(long pairedLinkId) {
        return 11_000_000L + (pairedLinkId % 1_000_000L);
    }

    public long nextIsolatedTerminalId() {
        return 11_000_000L + counter++;
    }
}
