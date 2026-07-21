"""
위성 이미지 → 도로 픽셀 마스크 추출

색상 기반 휴리스틱:
  - 도로는 회색/아스팔트 색상 (R≈G≈B, 밝기 60~200)
  - 인도/주차장 포함 가능 → 모폴로지로 정제
"""
from __future__ import annotations

import numpy as np
from skimage import morphology
from skimage.filters import gaussian


def extract_road_mask(
    image: np.ndarray,
    gray_tolerance: int = 25,
    brightness_min: int = 55,
    brightness_max: int = 210,
    min_road_area: int = 300,
) -> np.ndarray:
    """
    RGB 이미지에서 도로 픽셀 마스크(bool) 반환.

    Parameters
    ----------
    image           : (H, W, 3) uint8 RGB
    gray_tolerance  : R/G/B 채널 간 최대 허용 편차 (작을수록 순수 회색)
    brightness_min  : 최소 밝기 (너무 어두운 것 제외 - 그늘, 터널)
    brightness_max  : 최대 밝기 (너무 밝은 것 제외 - 지붕, 흰 건물)
    min_road_area   : 연결된 최소 도로 영역(픽셀)

    Returns
    -------
    mask : (H, W) bool
    """
    img = image.astype(np.float32)

    # 1. 채널 간 편차 (회색도)
    r, g, b = img[:, :, 0], img[:, :, 1], img[:, :, 2]
    channel_max = np.maximum(np.maximum(r, g), b)
    channel_min = np.minimum(np.minimum(r, g), b)
    gray_diff = (channel_max - channel_min)

    # 2. 밝기 (채널 평균)
    brightness = img.mean(axis=2)

    # 3. 기본 마스크
    road_mask = (
        (gray_diff   < gray_tolerance) &
        (brightness >= brightness_min)  &
        (brightness <= brightness_max)
    )

    # 4. 노이즈 제거 + 도로 선 연결
    road_mask = morphology.binary_closing(road_mask, morphology.disk(3))
    road_mask = morphology.binary_opening(road_mask, morphology.disk(2))

    # 5. 작은 독립 영역 제거
    road_mask = morphology.remove_small_objects(road_mask, min_size=min_road_area)

    return road_mask


def refine_with_edges(
    image: np.ndarray,
    mask: np.ndarray,
) -> np.ndarray:
    """
    Canny 엣지와 교차점을 활용해 마스크 확장 (선택적 후처리).
    현재는 단순히 gaussian blur + 팽창으로 선 두께 보완.
    """
    from skimage.filters import sobel
    gray = gaussian(image.mean(axis=2), sigma=1.0)
    edges = sobel(gray) > 0.05
    refined = mask | (edges & (image.mean(axis=2) < 200))
    refined = morphology.binary_dilation(refined, morphology.disk(1))
    return refined
