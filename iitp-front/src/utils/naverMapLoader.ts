/**
 * Naver Maps JavaScript API v3 동적 로더.
 *
 * - 클라이언트 ID(.env `REACT_APP_NAVER_MAP_CLIENT_ID`)가 없으면 조용히 실패(null)
 *   → 네이버 없이 기존 VWorld 배경으로 정상 동작.
 * - 스크립트는 1회만 로드(중복 방지), 이후 캐시된 Promise 재사용.
 * - Naver 타일 직접 사용(약관 위반)이 아니라 공식 JS API 를 쓴다.
 */

let loadPromise: Promise<typeof window.naver | null> | null = null;

declare global {
    interface Window {
        naver?: any;
    }
}

export function loadNaverMaps(): Promise<typeof window.naver | null> {
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve) => {
        // 이미 로드된 경우
        if (window.naver?.maps) {
            resolve(window.naver);
            return;
        }

        const clientId = process.env.REACT_APP_NAVER_MAP_CLIENT_ID;
        if (!clientId) {
            console.info("[naverMap] REACT_APP_NAVER_MAP_CLIENT_ID 미설정 → 네이버 배경 비활성(기존 배경 유지)");
            resolve(null);
            return;
        }

        const script = document.createElement("script");
        // ncpKeyId(신규) 우선, 구형은 ncpClientId — 콘솔 발급 형태에 따라. 우선 ncpKeyId 사용.
        script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`;
        script.async = true;
        script.onload = () => {
            if (window.naver?.maps) resolve(window.naver);
            else { console.warn("[naverMap] 스크립트 로드됐으나 naver.maps 없음(인증/도메인 확인)"); resolve(null); }
        };
        script.onerror = () => {
            console.warn("[naverMap] 스크립트 로드 실패(네트워크/도메인 등록 확인) → 네이버 배경 비활성");
            resolve(null);
        };
        document.head.appendChild(script);
    });

    return loadPromise;
}
