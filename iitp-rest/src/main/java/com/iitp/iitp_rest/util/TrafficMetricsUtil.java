package com.iitp.iitp_rest.util;

/**
 * 링크 혼잡도(V/C ratio)/서비스수준(LOS) 계산 — 순수 함수.
 *
 * <p>avgSpeed(VehicleEvent 스키마엔 spd 컬럼이 없어 항상 0)에 의존하지 않고
 * volume(고유 차량 수, 항상 유효) ÷ capacity(링크 정적 속성, 항상 유효)만으로 계산한다.
 */
public final class TrafficMetricsUtil {

    private TrafficMetricsUtil() {
    }

    /**
     * @param volume        시간창 내 고유 차량 수
     * @param windowSeconds 집계 시간창 길이(초)
     * @param capacity      링크 시간당 용량(veh/h)
     * @return volume을 시간당으로 환산한 값 / capacity. 계산 불가 시 -1
     */
    public static double vcRatio(int volume, int windowSeconds, double capacity) {
        if (capacity <= 0 || windowSeconds <= 0) return -1;
        double hourlyVolume = volume * 3600.0 / windowSeconds;
        return hourlyVolume / capacity;
    }

    /**
     * vcRatio 기반 단순 근사 등급 — 실제 HCM 교차로 제어지체 모델이 아니라
     * V/C만으로 판정하는 단순화된 프록시(데모/보고서 시각화 용도).
     *
     * @return "A".."F", vc < 0(계산 불가)이면 null
     */
    public static String losGrade(double vc) {
        if (vc < 0) return null;
        if (vc <= 0.60) return "A";
        if (vc <= 0.70) return "B";
        if (vc <= 0.80) return "C";
        if (vc <= 0.90) return "D";
        if (vc <= 1.00) return "E";
        return "F";
    }
}
