package com.iitp.iitp_rest.service.network;

import com.iitp.iitp_rest.model.network.section.SectionXml;
import com.iitp.iitp_rest.util.CoordinateUtils;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * KTDB 링크의 종단경사(&lt;section&gt;: slope/length/offset/left_id/right_id) 계산.
 *
 * <p>표준노드링크 원본(MOCT_LINK.shp/MOCT_NODE.shp)엔 경사·고도 필드가 전혀 없음을
 * {@code ogrinfo}로 직접 확인했다 — 별도 지형(DEM)에서 계산해야 한다. 부천 데이터에
 * 이미 있던 section 7개(NextSim 배포판 데모용)를 역산해보면 고정 거리 분할이 아니라
 * "지형 고도를 촘촘히 샘플링해 경사가 바뀌는 지점마다 구간을 나누고, 구간 length 합이
 * 링크 전체 길이와 정확히 일치"하는 패턴이었다 — 이 클래스가 그 패턴을 재현한다.
 *
 * <p>DEM 조회는 {@code gdallocationinfo} CLI를 배치 호출한다({@code -wgs84 -valonly},
 * stdin에 "lon lat" 여러 줄 → 한 프로세스로 순서대로 고도값 반환, 실측 5000점 0.092초).
 * <b>DEM 파일은 반드시 타일링+오버뷰가 돼 있어야 한다</b> — 원본 행 단위(untiled)
 * GeoTIFF는 임의 지점 조회 시 행 전체를 읽어야 해서 같은 5000점에 수 분(디스크 I/O
 * 대기, D 상태)이 걸림을 실측 확인. {@code gdal_translate -co TILED=YES -co
 * BLOCKXSIZE=256 -co BLOCKYSIZE=256 -co COMPRESS=DEFLATE ... && gdaladdo -r average
 * ... 2 4 8}로 재변환한 파일을 {@code ktdb.dem.path}에 지정할 것.
 *
 * <p>{@code ktdb.dem.path}가 비어있으면(로컬 개발 등, DEM 파일을 받을 디스크 여유가
 * 없는 환경) 이 서비스는 조용히 빈 결과를 반환한다 — 기존 동작(section 없음)과 100%
 * 동일하게 유지되어 하위 호환 걱정이 없다.
 */
@Slf4j
@Service
public class TerrainSlopeService {

    @Value("${ktdb.dem.path:}")
    private String demPath;

    /** 링크를 따라 고도를 샘플링하는 간격(m) — 촘촘할수록 경사 변화 지점을 정밀하게 잡지만 조회량이 늘어남 */
    @Value("${ktdb.dem.sample-interval-m:10}")
    private double sampleIntervalM;

    /** 이 값(%p)을 넘는 경사 변화가 생기면 새 section을 시작 */
    @Value("${ktdb.dem.slope-merge-threshold:1.5}")
    private double slopeMergeThreshold;

    /**
     * 경사 계산 전 고도 샘플에 적용할 이동평균 윈도우(샘플 개수) — 실측(부천 실제 링크,
     * 1m DEM): 스무딩 없이 계산하면 10m 구간에서 ±50~65% 같은 비현실적 경사 스파이크가
     * 튀었다(연석·주차차량·가로수 등 1m 해상도 LiDAR 표면 잡음, 도로 경사와 무관).
     * 5(=sampleIntervalM 10m 기준 50m 윈도우)로 완화 후 실제 도로 스케일 기복만 남고
     * 스파이크가 사라짐을 확인. 1 이하면 스무딩 비활성.
     */
    @Value("${ktdb.dem.smoothing-window-samples:5}")
    private int smoothingWindowSamples;

    /** 한 번의 gdallocationinfo 호출에 넣을 최대 점 개수 — 너무 크면 프로세스 메모리/응답 지연이 커짐 */
    private static final int BATCH_SIZE = 50_000;

    public boolean isConfigured() {
        return demPath != null && !demPath.isBlank();
    }

    /**
     * @param wgsCoordsByLinkId linkId → 그 링크의 WGS84 좌표열(KtdbLink.getCoords() 그대로,
     *                          각 원소는 "lat"/"lng" 키를 가진 Map)
     * @param lengthByLinkId    linkId → 링크 전체 길이(m) — section length 합이 이 값과 일치해야 함
     * @return linkId → section 목록. DEM 미설정이거나 입력이 비어있으면 빈 맵.
     */
    public Map<Long, List<SectionXml>> computeSections(
            Map<Long, List<Map<String, Double>>> wgsCoordsByLinkId,
            Map<Long, Double> lengthByLinkId) {
        if (!isConfigured() || wgsCoordsByLinkId.isEmpty()) return Map.of();

        // ── 1. 링크별 샘플 포인트 생성 ──────────────────────────────────────────
        record Sample(long linkId, double offset) {}
        List<double[]> queryPoints = new ArrayList<>(); // [lon, lat]
        List<Sample> refs = new ArrayList<>();
        Map<Long, List<Double>> offsetsByLink = new HashMap<>();

        for (var entry : wgsCoordsByLinkId.entrySet()) {
            long linkId = entry.getKey();
            List<Map<String, Double>> coords = entry.getValue();
            if (coords == null || coords.size() < 2) continue;
            Double length = lengthByLinkId.get(linkId);
            if (length == null || length < sampleIntervalM) continue;

            List<Double> offsets = sampleOffsets(length);
            List<double[]> lonLatAtOffsets = interpolateAlongPolyline(coords, offsets);
            offsetsByLink.put(linkId, offsets);
            for (double[] lonLat : lonLatAtOffsets) {
                queryPoints.add(lonLat);
            }
            for (double off : offsets) refs.add(new Sample(linkId, off));
        }
        if (queryPoints.isEmpty()) return Map.of();

        // ── 2. 배치 DEM 조회 ────────────────────────────────────────────────────
        double[] elevations;
        try {
            elevations = queryElevationsBatch(queryPoints);
        } catch (Exception e) {
            log.warn("[TerrainSlopeService] DEM 조회 실패 — section 없이 진행: {}", e.getMessage());
            return Map.of();
        }
        if (elevations.length != queryPoints.size()) {
            log.warn("[TerrainSlopeService] DEM 조회 결과 개수 불일치({} vs {}) — section 없이 진행",
                    elevations.length, queryPoints.size());
            return Map.of();
        }

        // ── 3. 링크별로 (offset, elevation) 묶어서 경사 변화 지점 기준 section 병합 ──
        Map<Long, List<double[]>> offsetElevByLink = new HashMap<>();
        for (int i = 0; i < refs.size(); i++) {
            Sample s = refs.get(i);
            offsetElevByLink.computeIfAbsent(s.linkId(), k -> new ArrayList<>())
                    .add(new double[]{s.offset(), elevations[i]});
        }

        Map<Long, List<SectionXml>> result = new HashMap<>();
        for (var entry : offsetElevByLink.entrySet()) {
            List<SectionXml> sections = mergeIntoSections(entry.getValue());
            if (!sections.isEmpty()) result.put(entry.getKey(), sections);
        }
        log.info("[TerrainSlopeService] 링크 {}개, 샘플 {}점 → section 생성 {}개 링크",
                wgsCoordsByLinkId.size(), queryPoints.size(), result.size());
        return result;
    }

    /** 0부터 length까지 sampleIntervalM 간격으로, 끝점(length)도 반드시 포함해 샘플 위치를 만든다. */
    private List<Double> sampleOffsets(double length) {
        List<Double> offsets = new ArrayList<>();
        for (double d = 0; d < length; d += sampleIntervalM) offsets.add(d);
        offsets.add(length);
        return offsets;
    }

    /**
     * 링크 좌표열(경위도 폴리라인)을 따라 누적거리 기준으로 offsets 지점들의 (lon,lat)을 선형보간한다.
     * 거리 계산은 이 코드베이스 전역에서 쓰는 평면 근사(CoordinateUtils, 한국 위도 기준 보정 상수)를 그대로 사용.
     */
    private List<double[]> interpolateAlongPolyline(List<Map<String, Double>> coords, List<Double> offsets) {
        int n = coords.size();
        double[] cumDist = new double[n];
        for (int i = 1; i < n; i++) {
            cumDist[i] = cumDist[i - 1] + planarDistanceM(coords.get(i - 1), coords.get(i));
        }
        double total = cumDist[n - 1];

        List<double[]> result = new ArrayList<>(offsets.size());
        int seg = 0;
        for (double off : offsets) {
            double target = Math.min(off, total);
            while (seg < n - 2 && cumDist[seg + 1] < target) seg++;
            double segLen = cumDist[seg + 1] - cumDist[seg];
            double t = segLen > 1e-9 ? (target - cumDist[seg]) / segLen : 0.0;
            Map<String, Double> a = coords.get(seg), b = coords.get(seg + 1);
            double lon = a.get("lng") + t * (b.get("lng") - a.get("lng"));
            double lat = a.get("lat") + t * (b.get("lat") - a.get("lat"));
            result.add(new double[]{lon, lat});
        }
        return result;
    }

    private double planarDistanceM(Map<String, Double> a, Map<String, Double> b) {
        double dLng = (b.get("lng") - a.get("lng")) * CoordinateUtils.METERS_PER_DEGREE_LNG;
        double dLat = (b.get("lat") - a.get("lat")) * CoordinateUtils.METERS_PER_DEGREE_LAT;
        return Math.hypot(dLng, dLat);
    }

    /**
     * (offset, elevation) 샘플들을, 경사가 {@link #slopeMergeThreshold}(%p) 이내로 유지되는
     * 동안 하나의 section으로 묶어 병합한다. 임계값을 넘는 순간 새 section을 시작 — 부천
     * 데모 데이터(12~213m의 불규칙한 구간 길이)와 같은 성격의 결과가 나오도록 그리디하게 처리.
     * 경사 계산은 {@link #smoothElevations} 로 평활화된 고도값 기준(원본 offset은 그대로 유지).
     */
    List<SectionXml> mergeIntoSections(List<double[]> offsetElev) {
        if (offsetElev.size() < 2) return List.of();
        offsetElev.sort((a, b) -> Double.compare(a[0], b[0]));
        offsetElev = smoothElevations(offsetElev);

        List<double[]> boundaries = new ArrayList<>(); // [offset, elevation] — section 경계점들
        boundaries.add(offsetElev.get(0));
        int sectionStartIdx = 0;
        for (int i = 2; i < offsetElev.size(); i++) {
            double[] start = offsetElev.get(sectionStartIdx);
            double[] prev = offsetElev.get(i - 1);
            double[] cur = offsetElev.get(i);
            double runningSlope = slopePercent(start, cur);
            double localSlope = slopePercent(prev, cur);
            if (Math.abs(localSlope - runningSlope) > slopeMergeThreshold) {
                boundaries.add(prev);
                sectionStartIdx = i - 1;
            }
        }
        boundaries.add(offsetElev.get(offsetElev.size() - 1));

        List<SectionXml> sections = new ArrayList<>();
        for (int i = 0; i < boundaries.size() - 1; i++) {
            double[] from = boundaries.get(i), to = boundaries.get(i + 1);
            double length = to[0] - from[0];
            if (length < 1e-6) continue; // 축퇴 구간 스킵
            SectionXml s = new SectionXml();
            s.setId((long) sections.size());
            s.setOffset(round2(from[0]));
            s.setLength(round2(length));
            s.setSlope(round2(slopePercent(from, to)));
            sections.add(s);
        }
        for (int i = 0; i < sections.size(); i++) {
            sections.get(i).setLeftId(i == 0 ? "None" : String.valueOf(i - 1));
            sections.get(i).setRightId(i == sections.size() - 1 ? "None" : String.valueOf(i + 1));
        }
        return sections;
    }

    /**
     * offset 기준으로 이미 정렬된 (offset, elevation) 샘플에 중심 이동평균을 적용한 새
     * 리스트를 반환한다(offset은 그대로, elevation만 평활화). 양 끝은 가용한 범위만큼만
     * 평균(비대칭 윈도우) — 링크 시작/끝점이 인접 링크와 이어지는 지점이라 임의로 자르면
     * offset 합이 안 맞게 되는 걸 방지.
     */
    private List<double[]> smoothElevations(List<double[]> offsetElev) {
        if (smoothingWindowSamples <= 1) return offsetElev;
        int half = smoothingWindowSamples / 2;
        int n = offsetElev.size();
        List<double[]> smoothed = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            int lo = Math.max(0, i - half);
            int hi = Math.min(n - 1, i + half);
            double sum = 0;
            for (int j = lo; j <= hi; j++) sum += offsetElev.get(j)[1];
            smoothed.add(new double[]{offsetElev.get(i)[0], sum / (hi - lo + 1)});
        }
        return smoothed;
    }

    private double slopePercent(double[] from, double[] to) {
        double horiz = to[0] - from[0];
        if (horiz < 1e-6) return 0.0;
        return (to[1] - from[1]) / horiz * 100.0;
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }

    /** gdallocationinfo -wgs84 -valonly {demPath} 를 배치 호출 — stdin에 "lon lat"를 여러 줄 흘리면 순서대로 고도값을 반환. */
    private double[] queryElevationsBatch(List<double[]> points) throws Exception {
        double[] result = new double[points.size()];
        int idx = 0;
        while (idx < points.size()) {
            int end = Math.min(idx + BATCH_SIZE, points.size());
            double[] chunk = queryElevationsChunk(points.subList(idx, end));
            System.arraycopy(chunk, 0, result, idx, chunk.length);
            idx = end;
        }
        return result;
    }

    private double[] queryElevationsChunk(List<double[]> points) throws Exception {
        ProcessBuilder pb = new ProcessBuilder("gdallocationinfo", "-wgs84", "-valonly", demPath);
        pb.redirectErrorStream(false);
        Process process = pb.start();

        Thread writer = new Thread(() -> {
            try (BufferedWriter w = new BufferedWriter(new OutputStreamWriter(process.getOutputStream(), StandardCharsets.UTF_8))) {
                for (double[] p : points) {
                    w.write(p[0] + " " + p[1]);
                    w.newLine();
                }
            } catch (Exception e) {
                log.warn("[TerrainSlopeService] gdallocationinfo stdin 쓰기 실패: {}", e.getMessage());
            }
        });
        writer.start();

        double[] out = new double[points.size()];
        try (BufferedReader r = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            for (int i = 0; i < points.size(); i++) {
                String line = r.readLine();
                out[i] = (line == null || line.isBlank()) ? 0.0 : Double.parseDouble(line.trim());
            }
        }
        writer.join();
        int exit = process.waitFor();
        if (exit != 0) {
            throw new IllegalStateException("gdallocationinfo 종료 코드 " + exit);
        }
        return out;
    }
}
