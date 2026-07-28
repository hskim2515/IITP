package com.iitp.iitp_rest.model.analytics;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * VWorld 행정구역 경계(시도/시군구/읍면동) — {@link com.iitp.iitp_rest.service.analytics.AdminBoundaryService}가
 * GetFeature 응답(MultiPolygon GeoJSON)을 파싱해 채운다.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class RegionBoundary {
    /** 법정동/행정구역 코드 (emd_cd/sig_cd/ctprvn_cd) */
    private String code;
    /** 한글 지역명 (emd_kor_nm/sig_kor_nm/ctp_kor_nm) */
    private String name;
    /** "sido" | "sigungu" | "eupmyeondong" */
    private String tier;
    /** MultiPolygon → 링(외곽선) 목록. 각 링은 [lon,lat] 점 배열 */
    private List<List<double[]>> rings;
}
