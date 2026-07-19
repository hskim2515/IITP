package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.mapper.network.NetworkMapper;
import com.iitp.iitp_rest.model.network.link.LinkResponse;
import com.iitp.iitp_rest.model.network.link.LinkXml;
import com.iitp.iitp_rest.model.network.node.NodeResponse;
import com.iitp.iitp_rest.model.network.node.NodeXml;
import com.iitp.iitp_rest.util.FileStorageService;
import jakarta.xml.bind.JAXBContext;
import jakarta.xml.bind.JAXBElement;
import jakarta.xml.bind.JAXBException;
import jakarta.xml.bind.Marshaller;
import jakarta.xml.bind.Unmarshaller;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import javax.xml.namespace.QName;
import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamReader;
import java.io.ByteArrayInputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.StringReader;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 대규모 네트워크용 스트리밍 diff 적용 (힙 상수 메모리).
 *
 * <p>기존 {@link NetworkTileService#applyDiff} 는 base network.xml 전체를
 * NetworkXml → NetworkResponse → Map 으로 3중 객체화한다 — 수도권(364MB XML,
 * 30만+ 링크)에서 힙 8GB 를 초과해 실패(실측). 이 서비스는 base XML 을
 * **텍스트 블록 단위로 스트림 통과**시키며 변경 대상 링크/노드 블록만
 * JAXB 로 개별 처리한다. 힙 사용 = 입력 byte[] 1벌 + 변경분 객체뿐.
 *
 * <p>블록 스캔 전제(스키마 실측): {@code <link>} 는 lane/cell/segment 를 품지만
 * link 를 중첩하지 않고, {@code <node>} 도 node 를 중첩하지 않는다. 따라서
 * {@code <link ...>}~{@code </link>} (또는 self-closing) 를 리터럴로 스캔해도 안전.
 *
 * <p>업서트 링크의 타일 경량화(차선/셀 제거) 복원은 기존 검증 로직
 * {@link NetworkTileService#restoreStrippedDetail} 을 그대로 재사용한다
 * (원본 블록만 개별 unmarshal → Response 병합 → 재marshal).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class NetworkStreamingDiffService {

    private final NetworkMapper networkMapper;
    private final FileStorageService fileStorage;

    /** 이 크기(MB) 초과 network.xml 은 diff 저장을 스트리밍 경로로 (전체 객체화 힙 초과 방지) */
    @org.springframework.beans.factory.annotation.Value("${network.diff.streaming-threshold-mb:100}")
    private int streamingThresholdMb;

    public boolean isLarge(long xmlBytes) {
        return xmlBytes > streamingThresholdMb * 1024L * 1024L;
    }

    private final JAXBContext jaxb = createContext();

    private static JAXBContext createContext() {
        try {
            return JAXBContext.newInstance(LinkXml.class, NodeXml.class);
        } catch (JAXBException e) {
            throw new IllegalStateException("JAXBContext(LinkXml/NodeXml) 초기화 실패", e);
        }
    }

    private static final Pattern ID_ATTR = Pattern.compile("\\bid=\"([^\"]+)\"");

    /**
     * base 버전의 network.xml 에 diff 를 적용해 target 버전의 network.xml 로 저장.
     * (DB jsonb 레이어는 쓰지 않는다 — 호출측이 stale 행 정리로 파일 폴백을 보장할 것)
     *
     * @return 적용 통계 (로그/검증용)
     */
    public DiffStats applyDiffStreaming(byte[] baseXml, String targetVersionId,
                                        List<LinkResponse> upsertLinks, List<NodeResponse> upsertNodes,
                                        List<Long> deleteLinkIds, List<Long> deleteNodeIds) throws Exception {
        Map<Long, LinkResponse> upsertLinkById = new LinkedHashMap<>();
        if (upsertLinks != null) {
            for (LinkResponse l : upsertLinks) if (l.getId() != null) upsertLinkById.put(l.getId(), l);
        }
        Map<Long, NodeResponse> upsertNodeById = new LinkedHashMap<>();
        if (upsertNodes != null) {
            for (NodeResponse n : upsertNodes) if (n.getId() != null) upsertNodeById.put(n.getId(), n);
        }
        Set<Long> delLinks = new HashSet<>(deleteLinkIds != null ? deleteLinkIds : List.of());
        Set<Long> delNodes = new HashSet<>(deleteNodeIds != null ? deleteNodeIds : List.of());
        // 삭제 대상은 업서트에서 제외 (기존 applyDiff 와 동일 규칙)
        delLinks.forEach(upsertLinkById::remove);
        delNodes.forEach(upsertNodeById::remove);

        DiffStats stats = new DiffStats();
        Path tmp = Files.createTempFile("network_diff_", ".xml");
        try {
            try (var reader = new java.io.BufferedReader(new java.io.InputStreamReader(
                         new ByteArrayInputStream(baseXml), StandardCharsets.UTF_8), 1 << 20);
                 Writer writer = Files.newBufferedWriter(tmp, StandardCharsets.UTF_8)) {
                transform(reader, writer, upsertLinkById, upsertNodeById, delLinks, delNodes, stats);
            }
            try (InputStream in = new FileInputStream(tmp.toFile())) {
                fileStorage.uploadFile(in, targetVersionId, "network.xml");
            }
            stats.outputBytes = Files.size(tmp);
            log.info("[NetworkStreamingDiff] {} 저장 완료: {} bytes (교체 L{}/N{}, 추가 L{}/N{}, 삭제 L{}/N{})",
                    targetVersionId, stats.outputBytes,
                    stats.replacedLinks, stats.replacedNodes,
                    stats.appendedLinks, stats.appendedNodes,
                    stats.deletedLinks, stats.deletedNodes);
            return stats;
        } finally {
            try { Files.deleteIfExists(tmp); } catch (IOException ignored) {}
        }
    }

    // ─────────────────────────── 스트림 변환 ───────────────────────────

    private void transform(java.io.BufferedReader reader, Writer writer,
                           Map<Long, LinkResponse> upsertLinks, Map<Long, NodeResponse> upsertNodes,
                           Set<Long> delLinks, Set<Long> delNodes, DiffStats stats) throws Exception {
        Set<Long> consumedLinks = new HashSet<>();
        Set<Long> consumedNodes = new HashSet<>();
        StringBuilder tag = null;
        int c;
        while ((c = reader.read()) >= 0) {
            char ch = (char) c;
            if (tag == null) {
                if (ch == '<') tag = new StringBuilder("<");
                else writer.write(ch);
                continue;
            }
            tag.append(ch);
            if (ch != '>') continue;
            String t = tag.toString();
            tag = null;

            if (t.startsWith("<link ")) {
                String block = t.endsWith("/>") ? t : t + readUntilClose(reader, "</link>");
                Long id = extractId(t);
                if (id != null && delLinks.contains(id)) { stats.deletedLinks++; continue; }
                LinkResponse upsert = id != null ? upsertLinks.get(id) : null;
                if (upsert != null) {
                    writer.write(marshalMergedLink(upsert, block));
                    consumedLinks.add(id);
                    stats.replacedLinks++;
                } else {
                    writer.write(block);
                }
            } else if (t.startsWith("<node ")) {
                String block = t.endsWith("/>") ? t : t + readUntilClose(reader, "</node>");
                Long id = extractId(t);
                if (id != null && delNodes.contains(id)) { stats.deletedNodes++; continue; }
                NodeResponse upsert = id != null ? upsertNodes.get(id) : null;
                if (upsert != null) {
                    writer.write(marshalNode(upsert));
                    consumedNodes.add(id);
                    stats.replacedNodes++;
                } else {
                    writer.write(block);
                }
            } else if (t.equals("</links>")) {
                // 신규 링크(기존에 없던 id) 추가
                for (Map.Entry<Long, LinkResponse> e : upsertLinks.entrySet()) {
                    if (consumedLinks.contains(e.getKey())) continue;
                    writer.write(marshalMergedLink(e.getValue(), null));
                    stats.appendedLinks++;
                }
                writer.write(t);
            } else if (t.equals("</nodes>")) {
                for (Map.Entry<Long, NodeResponse> e : upsertNodes.entrySet()) {
                    if (consumedNodes.contains(e.getKey())) continue;
                    writer.write(marshalNode(e.getValue()));
                    stats.appendedNodes++;
                }
                writer.write(t);
            } else {
                writer.write(t);
            }
        }
        if (tag != null) writer.write(tag.toString());
    }

    /** '<link ...>' 이후부터 종료 태그까지 읽어 붙인다 (종료 태그 포함) */
    private static String readUntilClose(java.io.BufferedReader reader, String closeTag) throws IOException {
        StringBuilder sb = new StringBuilder(4096);
        int matched = 0;
        int c;
        while ((c = reader.read()) >= 0) {
            char ch = (char) c;
            sb.append(ch);
            // closeTag 리터럴 매칭 (블록 내에 같은 문자열이 텍스트로 등장하지 않는 스키마 전제)
            matched = (ch == closeTag.charAt(matched)) ? matched + 1
                    : (ch == closeTag.charAt(0) ? 1 : 0);
            if (matched == closeTag.length()) return sb.toString();
        }
        throw new IOException("network.xml 스트림이 " + closeTag + " 없이 끝났습니다 (손상된 파일?)");
    }

    private static Long extractId(String openTag) {
        Matcher m = ID_ATTR.matcher(openTag);
        if (!m.find()) return null;
        try { return Long.parseLong(m.group(1)); } catch (NumberFormatException e) { return null; }
    }

    // ─────────────────────────── JAXB 조각 처리 ───────────────────────────

    /** 업서트 링크를 원본 블록과 병합(타일 경량화 복원) 후 XML 조각으로 */
    private String marshalMergedLink(LinkResponse upsert, String originalBlock) throws Exception {
        if (originalBlock != null) {
            LinkXml origXml = unmarshalFragment(originalBlock, LinkXml.class);
            LinkResponse orig = networkMapper.toResponse(origXml);
            NetworkTileService.restoreStrippedDetail(upsert, orig);
        }
        LinkXml xml = networkMapper.fromResponse(upsert);
        return marshalFragment(xml, "link", LinkXml.class);
    }

    private String marshalNode(NodeResponse upsert) throws Exception {
        NodeXml xml = networkMapper.fromResponse(upsert);
        return marshalFragment(xml, "node", NodeXml.class);
    }

    private <T> T unmarshalFragment(String block, Class<T> type) throws JAXBException, javax.xml.stream.XMLStreamException {
        Unmarshaller u = jaxb.createUnmarshaller();
        XMLInputFactory f = XMLInputFactory.newFactory();
        f.setProperty(XMLInputFactory.SUPPORT_DTD, false);
        XMLStreamReader sr = f.createXMLStreamReader(new StringReader(block));
        try {
            return u.unmarshal(sr, type).getValue();
        } finally {
            sr.close();
        }
    }

    private <T> String marshalFragment(T obj, String rootName, Class<T> type) throws JAXBException {
        Marshaller m = jaxb.createMarshaller();
        m.setProperty(Marshaller.JAXB_FRAGMENT, Boolean.TRUE); // XML 선언 생략
        m.setProperty(Marshaller.JAXB_FORMATTED_OUTPUT, Boolean.TRUE);
        java.io.StringWriter sw = new java.io.StringWriter();
        m.marshal(new JAXBElement<>(new QName(rootName), type, obj), sw);
        return sw.toString();
    }

    /** 적용 통계 */
    public static class DiffStats {
        public int replacedLinks, appendedLinks, deletedLinks;
        public int replacedNodes, appendedNodes, deletedNodes;
        public long outputBytes;
    }
}
