package com.iitp.iitp_rest.util;

import com.iitp.iitp_rest.model.geometry.Coordinates;
import com.iitp.iitp_rest.model.network.link.LinkXml;

import java.util.ArrayList;
import java.util.List;

/**
 * 로컬 좌표(shape 원본, WGS84 변환 전) 폴리라인 위에서의 차선 중심선 계산 / 호(arc-length) 기반
 * 점 변환 유틸. {@code PavementMarkingCoordinateResolver}에 있던 로직을 그대로 옮겨 여러 서비스가
 * 공유하도록 추출했다(동작 변경 없음).
 */
public final class LaneGeometryUtils {

    private LaneGeometryUtils() {
    }

    /** link.shape(로컬 x,y)에 laneIdx 차선의 폭 오프셋을 적용한 중심선 — 프론트
     *  interpolateByOffset.ts의 computeLaneCenterlineOl과 동일한 정점별 법선 오프셋 방식
     *  (차선0=최좌측 관례도 동일). lane.shape 자체는 신뢰 불가(링크와 동일값 중복 저장됨)라
     *  link.shape+width+laneIdx로 재구성하는 것이 이 앱의 관례. */
    public static List<Coordinates> computeLaneCenterline(LinkXml link, int laneIdx) {
        List<Coordinates> coords = CoordinateUtils.parse(link.getShape());
        if (coords.size() < 2) return null;
        int laneCount = link.getLanes() != null ? link.getLanes().size() : 1;
        if (laneCount == 0) return null;
        double width = link.getWidth() > 0 ? link.getWidth() : 7.0;
        double laneWidth = width / laneCount;
        double lateralOffset = (laneIdx - (laneCount - 1) / 2.0) * laneWidth;
        if (lateralOffset == 0) return coords;

        List<Coordinates> result = new ArrayList<>(coords.size());
        for (int i = 0; i < coords.size(); i++) {
            Coordinates p = coords.get(i);
            Coordinates prev = coords.get(Math.max(0, i - 1));
            Coordinates next = coords.get(Math.min(coords.size() - 1, i + 1));
            double dx = next.getLng() - prev.getLng(), dy = next.getLat() - prev.getLat();
            double len = Math.hypot(dx, dy);
            if (len < 1e-6) {
                result.add(p);
                continue;
            }
            // 우측(+) 법선 — NetworkFeatureLayer.buildLinkFeatures / 프론트
            // computeLaneCenterlineOl과 동일해야 함.
            double nx = dy / len, ny = -dx / len;
            Coordinates offsetPt = new Coordinates();
            offsetPt.setLng(p.getLng() + nx * lateralOffset);
            offsetPt.setLat(p.getLat() + ny * lateralOffset);
            result.add(offsetPt);
        }
        return result;
    }

    /** 로컬 좌표 폴리라인(x,y)을 따라 offset(누적 실거리, m) 지점의 [x, y, angle]을 계산.
     *  프론트 interpolateByOffset.ts의 interpolateAlongLine과 동일한 정의(각도 관례 포함). */
    public static double[] pointAndAngleAtOffset(List<Coordinates> pts, double offset) {
        double accumulated = 0;
        for (int i = 1; i < pts.size(); i++) {
            double x1 = pts.get(i - 1).getLng(), y1 = pts.get(i - 1).getLat();
            double x2 = pts.get(i).getLng(), y2 = pts.get(i).getLat();
            double segLen = Math.hypot(x2 - x1, y2 - y1);
            if (segLen == 0) continue;
            if (accumulated + segLen >= offset) {
                double ratio = (offset - accumulated) / segLen;
                double x = x1 + ratio * (x2 - x1);
                double y = y1 + ratio * (y2 - y1);
                double angle = Math.atan2(x2 - x1, y2 - y1);
                return new double[]{x, y, angle};
            }
            accumulated += segLen;
        }
        // offset이 폴리라인 전체 길이를 살짝 넘으면 끝점으로 클램프
        Coordinates p1 = pts.get(pts.size() - 2), p2 = pts.get(pts.size() - 1);
        double angle = Math.atan2(p2.getLng() - p1.getLng(), p2.getLat() - p1.getLat());
        return new double[]{p2.getLng(), p2.getLat(), angle};
    }

    /** 폴리라인의 전체 호(arc-length) 길이. */
    public static double totalLength(List<Coordinates> pts) {
        double total = 0;
        for (int i = 1; i < pts.size(); i++) {
            total += Math.hypot(
                    pts.get(i).getLng() - pts.get(i - 1).getLng(),
                    pts.get(i).getLat() - pts.get(i - 1).getLat());
        }
        return total;
    }

    /**
     * 임의의 점 (x,y)를 폴리라인 pts 위로 투영해 가장 가까운 지점을 찾는다
     * ({@link #pointAndAngleAtOffset}의 역방향 연산 — "점 → 호 길이").
     *
     * @return {arcLenAtProjection, distanceFromQueryPoint, projectedX, projectedY} — pts.size()<2면 null
     */
    public static double[] nearestPointOnPolyline(List<Coordinates> pts, double x, double y) {
        if (pts == null || pts.size() < 2) return null;

        double bestDist = Double.MAX_VALUE;
        double bestArcLen = 0;
        double bestX = pts.get(0).getLng();
        double bestY = pts.get(0).getLat();
        double accumulated = 0;

        for (int i = 1; i < pts.size(); i++) {
            double x1 = pts.get(i - 1).getLng(), y1 = pts.get(i - 1).getLat();
            double x2 = pts.get(i).getLng(), y2 = pts.get(i).getLat();
            double segDx = x2 - x1, segDy = y2 - y1;
            double segLenSq = segDx * segDx + segDy * segDy;

            double t;
            if (segLenSq < 1e-12) {
                t = 0;
            } else {
                t = ((x - x1) * segDx + (y - y1) * segDy) / segLenSq;
                t = Math.max(0, Math.min(1, t));
            }
            double projX = x1 + t * segDx;
            double projY = y1 + t * segDy;
            double dist = Math.hypot(x - projX, y - projY);
            double segLen = Math.sqrt(segLenSq);

            if (dist < bestDist) {
                bestDist = dist;
                bestArcLen = accumulated + t * segLen;
                bestX = projX;
                bestY = projY;
            }
            accumulated += segLen;
        }

        return new double[]{bestArcLen, bestDist, bestX, bestY};
    }
}
