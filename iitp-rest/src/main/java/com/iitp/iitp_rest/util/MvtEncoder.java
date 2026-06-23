package com.iitp.iitp_rest.util;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 최소 MVT(Mapbox Vector Tile, PBF) 인코더 — Point / LineString 만 지원, 의존성 0.
 *
 * <p>SQLite 에는 PostGIS 의 {@code ST_AsMVT} 가 없어, 네트워크 overview/mid 타일을 직접
 * MVT 바이트로 인코딩한다. 단일 레이어, 속성(tags) 없이 feature id + geometry 만 담아
 * 버그 표면을 최소화한다. (vector_tile.proto v2 기준)
 *
 * <p>좌표는 타일-로컬 정수(0..extent). 호출자가 lng/lat → 타일-로컬 변환 후 전달한다.
 */
public final class MvtEncoder {

    private final ByteArrayOutputStream layerBody = new ByteArrayOutputStream();
    private final String layerName;
    private final int extent;
    private int featureCount = 0;

    public MvtEncoder(String layerName, int extent) {
        this.layerName = layerName;
        this.extent = extent;
    }

    /** LineString feature 추가. coords: [[x,y],...] 타일-로컬 정수 */
    public void addLineString(long id, int[][] coords) {
        if (coords == null || coords.length < 2) return;
        List<Integer> geom = encodeLine(coords);
        writeFeature(id, 2 /*LINESTRING*/, geom);
    }

    /** Point feature 추가. (x,y) 타일-로컬 정수 */
    public void addPoint(long id, int x, int y) {
        List<Integer> geom = new ArrayList<>();
        geom.add(command(1, 1));     // MoveTo, count 1
        geom.add(zigzag(x));
        geom.add(zigzag(y));
        writeFeature(id, 1 /*POINT*/, geom);
    }

    public boolean isEmpty() { return featureCount == 0; }

    /** 전체 Tile 바이트 반환 */
    public byte[] finish() {
        // Layer 메시지 구성: version(15)=2, name(1), features(2, 누적됨), extent(5)
        ByteArrayOutputStream layer = new ByteArrayOutputStream();
        writeTag(layer, 15, 0); writeVarint(layer, 2);                 // version=2
        writeTag(layer, 1, 2);  writeLengthDelimited(layer, layerName.getBytes()); // name
        try { layer.write(layerBody.toByteArray()); } catch (Exception ignored) {} // features (tag 2 포함 누적)
        writeTag(layer, 5, 0);  writeVarint(layer, extent);            // extent

        // Tile 메시지: layers(3)
        ByteArrayOutputStream tile = new ByteArrayOutputStream();
        writeTag(tile, 3, 2);
        writeLengthDelimited(tile, layer.toByteArray());
        return tile.toByteArray();
    }

    // ── Feature 직렬화 (layerBody 에 tag2 length-delimited 로 누적) ──
    private void writeFeature(long id, int geomType, List<Integer> geom) {
        ByteArrayOutputStream f = new ByteArrayOutputStream();
        writeTag(f, 1, 0); writeVarint(f, id);            // id
        writeTag(f, 3, 0); writeVarint(f, geomType);      // type
        // geometry (field 4, packed uint32)
        ByteArrayOutputStream g = new ByteArrayOutputStream();
        for (int v : geom) writeVarint(g, v & 0xFFFFFFFFL);
        writeTag(f, 4, 2); writeLengthDelimited(f, g.toByteArray());

        writeTag(layerBody, 2, 2);                        // Layer.features field 2
        writeLengthDelimited(layerBody, f.toByteArray());
        featureCount++;
    }

    private List<Integer> encodeLine(int[][] coords) {
        List<Integer> g = new ArrayList<>();
        int cx = 0, cy = 0;
        // MoveTo 첫 점
        g.add(command(1, 1));
        int dx = coords[0][0] - cx, dy = coords[0][1] - cy;
        g.add(zigzag(dx)); g.add(zigzag(dy));
        cx = coords[0][0]; cy = coords[0][1];
        // LineTo 나머지
        g.add(command(2, coords.length - 1));
        for (int i = 1; i < coords.length; i++) {
            dx = coords[i][0] - cx; dy = coords[i][1] - cy;
            g.add(zigzag(dx)); g.add(zigzag(dy));
            cx = coords[i][0]; cy = coords[i][1];
        }
        return g;
    }

    // ── 인코딩 헬퍼 ──
    private static int command(int id, int count) { return (id & 0x7) | (count << 3); }
    private static int zigzag(int n) { return (n << 1) ^ (n >> 31); }

    private static void writeTag(ByteArrayOutputStream out, int field, int wireType) {
        writeVarint(out, ((long) field << 3) | wireType);
    }
    private static void writeLengthDelimited(ByteArrayOutputStream out, byte[] data) {
        writeVarint(out, data.length);
        out.write(data, 0, data.length);
    }
    private static void writeVarint(ByteArrayOutputStream out, long value) {
        while (true) {
            if ((value & ~0x7FL) == 0) { out.write((int) value); return; }
            out.write((int) ((value & 0x7F) | 0x80));
            value >>>= 7;
        }
    }
}
