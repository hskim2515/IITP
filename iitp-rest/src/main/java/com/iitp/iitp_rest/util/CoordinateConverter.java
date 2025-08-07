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

    private final CoordinateTransform wgsToMercator;
    private final CoordinateTransform mercatorToWgs;

    public CoordinateConverter() {
        CRSFactory crsFactory = new CRSFactory();
        CoordinateReferenceSystem wgs84 = crsFactory.createFromName("EPSG:4326");
        CoordinateReferenceSystem webMercator = crsFactory.createFromName("EPSG:3857");

        CoordinateTransformFactory transformFactory = new CoordinateTransformFactory();
        this.wgsToMercator = transformFactory.createTransform(wgs84, webMercator);
        this.mercatorToWgs = transformFactory.createTransform(webMercator, wgs84);
    }

    public void setBasePoint(double lon, double lat) {
        this.baseLon = lon;
        this.baseLat = lat;
    }

    public void setRoadPoint(double baseEasting, double baseNorthing, double targetEasting, double targetNorthing) {
        this.roadBaseEasting = baseEasting;
        this.roadBaseNorthing = baseNorthing;
        this.roadTargetEasting = targetEasting;
        this.roadTargetNorthing = targetNorthing;
    }


    public ProjCoordinate toAbsolute(double relX, double relY) {
        // 1. 차선 방향 벡터 구하기
        double dirX = roadTargetEasting - roadBaseEasting;
        double dirY = roadTargetNorthing - roadBaseNorthing;
        double length = Math.sqrt(dirX * dirX + dirY * dirY);
        dirX /= length;
        dirY /= length;

        // 2. 상대좌표 회전 적용
        double dx = relX * dirX - relY * dirY;
        double dy = relX * dirY + relY * dirX;

        // 3. 실제 위치 계산 (easting/northing 기반)
        double absX = roadBaseEasting + dx;
        double absY = roadBaseNorthing + dy;

        // 4. 근사 위경도 변환 (정밀 필요시 Proj4J 사용 권장)
        double lon = baseLon + absX / 88000.0;
        double lat = baseLat + absY / 111000.0;

        return new ProjCoordinate(lon, lat, 0);
    }


}
