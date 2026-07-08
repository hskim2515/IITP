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
        // 이미 로드된 경우: Panorama 서브모듈이 없으면 재로드가 필요하므로 캐시 반환하지 않는다.
        if (window.naver?.maps?.Panorama) {
            console.log("[naverMap] 이미 로드됨(Panorama 포함) → 캐시 반환");
            resolve(window.naver);
            return;
        }
        if (window.naver?.maps && !window.naver.maps.Panorama) {
            console.warn("[naverMap] 지도는 로드됐으나 Panorama 없음 → panorama 서브모듈 재로드");
            // 아래로 진행해 submodules=panorama 스크립트를 추가 로드
        }

        const clientId = process.env.REACT_APP_NAVER_MAP_CLIENT_ID;
        if (!clientId) {
            console.info("[naverMap] REACT_APP_NAVER_MAP_CLIENT_ID 미설정 → 네이버 배경 비활성(기존 배경 유지)");
            resolve(null);
            return;
        }

        const script = document.createElement("script");
        // 파라미터 이름은 콘솔 유형에 따라 다름:
        //   - 신규(신 콘솔 "Maps"): ncpKeyId
        //   - 구형(기존 API): ncpClientId
        // .env REACT_APP_NAVER_MAP_PARAM 로 전환 가능(기본 ncpKeyId). 401 나면 ncpClientId 로 시도.
        const param = process.env.REACT_APP_NAVER_MAP_PARAM || "ncpKeyId";
        // submodules=panorama: 거리뷰(naver.maps.Panorama)는 별도 서브모듈이라 명시 로드해야 한다.
        //   (기본 maps.js 에는 지도만 포함 → Panorama 클래스가 undefined)
        script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?${param}=${encodeURIComponent(clientId)}&submodules=panorama`;
        console.log("[naverMap] 스크립트 로드 시작:", script.src);
        script.async = true;
        script.onload = () => {
            // ⚠️ 메인 스크립트 onload 후에도 submodules(panorama)는 별도 비동기 로드된다 →
            //   onload 시점엔 naver.maps 는 있지만 naver.maps.Panorama 는 아직 없다.
            //   Panorama 가 준비될 때까지 짧게 폴링(최대 ~5초)한 뒤 resolve.
            if (!window.naver?.maps) { console.warn("[naverMap] naver.maps 없음(인증/도메인 확인)"); resolve(null); return; }
            let tries = 0;
            const wait = () => {
                if (window.naver?.maps?.Panorama) { resolve(window.naver); return; }
                if (++tries > 100) { console.warn("[naverMap] Panorama 서브모듈 로드 타임아웃 → 지도만 사용"); resolve(window.naver); return; }
                setTimeout(wait, 50);
            };
            wait();
        };
        script.onerror = () => {
            console.warn("[naverMap] 스크립트 로드 실패(네트워크/도메인 등록 확인) → 네이버 배경 비활성");
            resolve(null);
        };
        document.head.appendChild(script);
    });

    return loadPromise;
}
