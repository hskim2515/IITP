package com.iitp.iitp_rest.service.network;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import javax.xml.stream.XMLInputFactory;
import javax.xml.stream.XMLStreamConstants;
import javax.xml.stream.XMLStreamReader;
import java.io.BufferedInputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * osmium tags-filter로 뽑은 OSM 신호등(highway=traffic_signals) XML을 osm_traffic_signal에
 * 적재한다. OsmPtFacilityImporter/OsmTurnRestrictionImporter와 동일한 패턴.
 *
 * <p>사전 준비(별도 실행, osmium-tool 필요):
 * <pre>
 * osmium tags-filter south-korea-latest.osm.pbf n/highway=traffic_signals -o signals.osm.pbf
 * osmium cat signals.osm.pbf -o signals.osm.xml
 * </pre>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class OsmTrafficSignalImporter {

    private static final int BATCH_SIZE = 5000;

    private final JdbcTemplate jdbc;

    public record ImportResult(long signalCount, long elapsedMs) {}

    public ImportResult importFromXml(Path osmXmlFile) throws Exception {
        long start = System.currentTimeMillis();
        log.info("[OsmTrafficSignalImporter] 임포트 시작: {}", osmXmlFile);

        jdbc.execute("TRUNCATE osm_traffic_signal");

        XMLInputFactory factory = XMLInputFactory.newInstance();
        factory.setProperty(XMLInputFactory.SUPPORT_DTD, false);

        long count = 0;
        List<Object[]> batch = new ArrayList<>(BATCH_SIZE);

        try (InputStream in = new BufferedInputStream(new FileInputStream(osmXmlFile.toFile()), 1 << 20)) {
            XMLStreamReader reader = factory.createXMLStreamReader(in);
            while (reader.hasNext()) {
                int event = reader.next();
                if (event == XMLStreamConstants.START_ELEMENT && "node".equals(reader.getLocalName())) {
                    long id = Long.parseLong(reader.getAttributeValue(null, "id"));
                    double lat = Double.parseDouble(reader.getAttributeValue(null, "lat"));
                    double lon = Double.parseDouble(reader.getAttributeValue(null, "lon"));
                    batch.add(new Object[]{id, lat, lon, lon, lat});
                    count++;
                    if (batch.size() >= BATCH_SIZE) { flush(batch); batch.clear(); }
                }
            }
            reader.close();
        }
        if (!batch.isEmpty()) flush(batch);

        jdbc.update("DELETE FROM osm_traffic_signal_import_meta");
        jdbc.update("INSERT INTO osm_traffic_signal_import_meta (id, imported_at, source_file, signal_count) " +
                        "VALUES (1, ?, ?, ?)",
                Timestamp.valueOf(LocalDateTime.now()), osmXmlFile.toString(), count);

        long elapsed = System.currentTimeMillis() - start;
        log.info("[OsmTrafficSignalImporter] 완료: 신호등 {}개 ({}ms)", count, elapsed);
        return new ImportResult(count, elapsed);
    }

    private void flush(List<Object[]> batch) {
        jdbc.batchUpdate(
                "INSERT INTO osm_traffic_signal (id, lat, lon, geom) " +
                        "VALUES (?, ?, ?, ST_SetSRID(ST_MakePoint(?, ?), 4326)) ON CONFLICT (id) DO NOTHING",
                batch);
    }
}
