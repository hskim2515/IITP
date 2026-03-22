package com.iitp.iitp_rest.util;

import org.locationtech.proj4j.CRSFactory;
import org.locationtech.proj4j.CoordinateReferenceSystem;
import org.locationtech.proj4j.CoordinateTransform;
import org.locationtech.proj4j.CoordinateTransformFactory;
import org.locationtech.proj4j.ProjCoordinate;

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


}
