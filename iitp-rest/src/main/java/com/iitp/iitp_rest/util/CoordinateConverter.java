package com.iitp.iitp_rest.util;

import org.locationtech.proj4j.CRSFactory;
import org.locationtech.proj4j.CoordinateReferenceSystem;
import org.locationtech.proj4j.CoordinateTransform;
import org.locationtech.proj4j.CoordinateTransformFactory;
import org.locationtech.proj4j.ProjCoordinate;

public class CoordinateConverter {

    private double baseLon;
    private double baseLat;
    private double baseEasting;
    private double baseNorthing;

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

        // 위경도 -> WebMercator로 변환
        ProjCoordinate geoCoord = new ProjCoordinate(lon, lat);
        ProjCoordinate mercatorCoord = new ProjCoordinate();
        wgsToMercator.transform(geoCoord, mercatorCoord);

        this.baseEasting = mercatorCoord.x;
        this.baseNorthing = mercatorCoord.y;
    }

    public ProjCoordinate toAbsolute(double relX, double relY) {
        double absoluteEasting = baseEasting + relX;
        double absoluteNorthing = baseNorthing + relY;

        ProjCoordinate mercatorCoord = new ProjCoordinate(absoluteEasting, absoluteNorthing);
        ProjCoordinate geoCoord = new ProjCoordinate();

        mercatorToWgs.transform(mercatorCoord, geoCoord);
        return geoCoord;
    }
}
