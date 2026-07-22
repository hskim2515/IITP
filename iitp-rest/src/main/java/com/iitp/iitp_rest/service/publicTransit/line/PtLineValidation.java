package com.iitp.iitp_rest.service.publicTransit.line;

import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 버스/철도 노선(PT Line) ↔ 네트워크(링크/노드)/정류장 참조 검증.
 *
 * <p>{@code BusPtLinesXml.LineXml}은 {@code <link seq="...">}/{@code <node seq="...">}/
 * {@code <station seq="...">}/{@code <garage seq="...">} 4개의 id 시퀀스를 동시에 참조한다.
 * KTDB 재임포트는 링크/노드 id를 전면 교체하므로(odmatrix.xml/signal.xml과 동일한 문제),
 * 재임포트 후 기존 노선이 새 네트워크와 안 맞을 수 있는데 지금까지 이를 검증하는 코드
 * 자체가 없었다 — {@code BusPtLineService}/{@code RailPtLineService}는 순수 SFTP CRUD.
 *
 * <p>정류장(station)/차고지(garage) id는 KTDB 재임포트로 바뀌지 않는 별도 네임스페이스라
 * (OSM 임포트로만 생성, KTDB는 정류장 자체를 만들지 않음) 이 검증 대상에서 제외한다 —
 * 노선이 정말 깨지는 건 재임포트로 통째 바뀌는 link/node seq 쪽이다.
 *
 * <p>signal.xml/odmatrix.xml 검증({@code NextSimInputScaffolder})과 동일하게 "참조가
 * 없으면(빈 파일 등) 유효"로 본다 — 대조 불가능한 상태를 무효로 잘못 판정하지 않기 위함.
 */
public final class PtLineValidation {

    private PtLineValidation() {}

    private static final Pattern BUS_SEQ = Pattern.compile("<(link|node)\\s+seq=\"([^\"]*)\"");
    private static final Pattern RAIL_STATION_SEQ = Pattern.compile("railStationSeq=\"([^\"]*)\"");

    /** roadPTline(.xml) 컨텐츠의 link/node seq가 전부 새 네트워크에 존재하는지 검증. */
    public static boolean busRouteValid(String linesXmlContent, Set<String> validLinkIds, Set<String> validNodeIds) {
        if (linesXmlContent == null || linesXmlContent.isBlank()) return true;
        Matcher m = BUS_SEQ.matcher(linesXmlContent);
        while (m.find()) {
            String kind = m.group(1);
            String seq = m.group(2);
            if (seq == null || seq.isBlank()) continue;
            Set<String> validSet = "link".equals(kind) ? validLinkIds : validNodeIds;
            if (validSet == null) continue; // 대조 불가 — 보수적으로 통과
            for (String id : seq.trim().split("\\s+")) {
                if (!validSet.contains(id)) return false;
            }
        }
        return true;
    }

    /** railPTLine(.xml) 컨텐츠의 railStationSeq가 전부 현재 정류장 집합에 존재하는지 검증. */
    public static boolean railRouteValid(String routesXmlContent, Set<String> validStationIds) {
        if (routesXmlContent == null || routesXmlContent.isBlank()) return true;
        if (validStationIds == null) return true; // 대조 불가 — 보수적으로 통과
        Matcher m = RAIL_STATION_SEQ.matcher(routesXmlContent);
        while (m.find()) {
            String seq = m.group(1);
            if (seq == null || seq.isBlank()) continue;
            for (String id : seq.trim().split("\\s+")) {
                if (!validStationIds.contains(id)) return false;
            }
        }
        return true;
    }
}
