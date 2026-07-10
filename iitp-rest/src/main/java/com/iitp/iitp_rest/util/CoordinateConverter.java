package com.iitp.iitp_rest.util;

import org.locationtech.proj4j.CRSFactory;
import org.locationtech.proj4j.CoordinateReferenceSystem;
import org.locationtech.proj4j.CoordinateTransform;
import org.locationtech.proj4j.CoordinateTransformFactory;
import org.locationtech.proj4j.ProjCoordinate;

import java.util.List;

public class CoordinateConverter {

    private double baseLon;
    private double baseLat;
    private double roadBaseEasting;
    private double roadBaseNorthing;
    private double roadTargetEasting;
    private double roadTargetNorthing;
    private double halfWidth;

    private static final CoordinateTransform wgsToMercator;
    private static final CoordinateTransform mercatorToWgs;

    static  {
        CRSFactory crsFactory = new CRSFactory();
        CoordinateReferenceSystem wgs84 = crsFactory.createFromName("EPSG:4326");
        CoordinateReferenceSystem webMercator = crsFactory.createFromName("EPSG:3857");

        CoordinateTransformFactory transformFactory = new CoordinateTransformFactory();
        wgsToMercator = transformFactory.createTransform(wgs84, webMercator);
        mercatorToWgs = transformFactory.createTransform(webMercator, wgs84);
    }
    public CoordinateConverter() {
    }

    public void setBasePoint(double lon, double lat) {
        this.baseLon = lon;
        this.baseLat = lat;
    }

    public void setRoadPoint(double baseEasting, double baseNorthing, double targetEasting, double targetNorthing, double halfWidth) {
        this.roadBaseEasting = baseEasting;
        this.roadBaseNorthing = baseNorthing;
        this.roadTargetEasting = targetEasting;
        this.roadTargetNorthing = targetNorthing;
        this.halfWidth = halfWidth;
    }

    public ProjCoordinate toAbsolute(double posX, double posY) {
        // 1. 링크 방향 단위 벡터
        double dirX = roadTargetEasting - roadBaseEasting;
        double dirY = roadTargetNorthing - roadBaseNorthing;
        double length = Math.sqrt(dirX * dirX + dirY * dirY);
        dirX /= length;
        dirY /= length;

        // 2. pos_x/pos_y는 링크 기준 좌표계:
        //    pos_x = 링크 시작점으로부터 진행방향 거리(m)
        //    pos_y = 링크 왼쪽 엣지로부터 오른쪽 방향 거리(m)
        //    왼쪽 방향 벡터 = (-dirY, dirX), 오른쪽 방향 벡터 = (dirY, -dirX)
        double leftEdgeX = roadBaseEasting + halfWidth * (-dirY);
        double leftEdgeY = roadBaseNorthing + halfWidth * (dirX);

        double absX = leftEdgeX + posX * dirX + posY * dirY;
        double absY = leftEdgeY + posX * dirY - posY * dirX;

        // 3. 근사 위경도 변환
        double lon = baseLon + absX / 88000.0;
        double lat = baseLat + absY / 111000.0;

        return new ProjCoordinate(lon, lat, 0);
    }

    /**
     * 링크 shape 폴리라인을 따라 posX 거리만큼 이동한 후, 현재 세그먼트 방향 기준으로
     * posY(좌측 엣지 → 우측 방향 거리)를 적용해 최종 위치를 반환합니다.
     * toAbsolute와 동일한 좌표계를 사용하되, 직선이 아닌 폴리라인을 따릅니다.
     */
    public static ProjCoordinate interpolateAlongShapeWithOffset(
            List<double[]> shape, double posX, double posY, double halfWidth,
            double baseLon, double baseLat) {
        if (shape == null || shape.isEmpty()) return null;

        double remaining = posX;
        for (int i = 0; i < shape.size() - 1; i++) {
            double[] from = shape.get(i);
            double[] to   = shape.get(i + 1);
            double dx = to[0] - from[0];
            double dy = to[1] - from[1];
            double segLen = Math.sqrt(dx * dx + dy * dy);

            if (remaining <= segLen || i == shape.size() - 2) {
                double t = segLen > 0 ? Math.min(remaining / segLen, 1.0) : 0.0;
                double cx = from[0] + t * dx;
                double cy = from[1] + t * dy;

                if (segLen > 0) {
                    // 단위 방향 벡터 (진행방향)
                    double ux = dx / segLen;
                    double uy = dy / segLen;
                    // 좌측 엣지: center + halfWidth * leftPerp(-uy, ux)
                    double lx = cx - halfWidth * uy;
                    double ly = cy + halfWidth * ux;
                    // posY 만큼 우측(uy, -ux) 방향 이동
                    cx = lx + posY * uy;
                    cy = ly - posY * ux;
                }

                return toWgs84(cx, cy, baseLon, baseLat);
            }
            remaining -= segLen;
        }

        double[] last = shape.get(shape.size() - 1);
        return toWgs84(last[0], last[1], baseLon, baseLat);
    }

    /**
     * 차선 중심선 shape 폴리라인을 따라 posX 거리만큼 이동한 위치를 반환합니다.
     * laneShape: 차선 중심선의 로컬 좌표 점 목록 ([x, y])
     * posX: 차선 시작점으로부터의 진행 거리(m)
     */
    public static ProjCoordinate interpolateAlongLane(List<double[]> laneShape, double posX, double baseLon, double baseLat) {
        if (laneShape == null || laneShape.isEmpty()) return null;
        if (laneShape.size() == 1) {
            return toWgs84(laneShape.get(0)[0], laneShape.get(0)[1], baseLon, baseLat);
        }

        double remaining = posX;
        for (int i = 0; i < laneShape.size() - 1; i++) {
            double[] from = laneShape.get(i);
            double[] to   = laneShape.get(i + 1);
            double dx = to[0] - from[0];
            double dy = to[1] - from[1];
            double segLen = Math.sqrt(dx * dx + dy * dy);

            if (remaining <= segLen || i == laneShape.size() - 2) {
                double t = segLen > 0 ? Math.min(remaining / segLen, 1.0) : 0.0;
                return toWgs84(from[0] + t * dx, from[1] + t * dy, baseLon, baseLat);
            }
            remaining -= segLen;
        }

        double[] last = laneShape.get(laneShape.size() - 1);
        return toWgs84(last[0], last[1], baseLon, baseLat);
    }

    private static ProjCoordinate toWgs84(double localX, double localY, double baseLon, double baseLat) {
        return new ProjCoordinate(baseLon + localX / 88000.0, baseLat + localY / 111000.0, 0);
    }

}
