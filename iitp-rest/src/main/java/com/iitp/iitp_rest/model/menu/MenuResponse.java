package com.iitp.iitp_rest.model.menu;

import com.iitp.iitp_rest.model.role.Role;
import lombok.Data;

@Data
public class MenuResponse {
    /** 메뉴 언어 */
    private Long menuId;
    /** 메뉴 코드 */
    private String menuCode;
    /** 메뉴 언어 */
    private String language;
    /** 한글 메뉴 명 */
    private String nameKor;
    /** 영어 메뉴 명 */
    private String nameEn;
    /** 부모 ID */
    private Long parentsId;
    private Long rootId;
    /** 메뉴 깊이 */
    private Integer depth;
    /** 메뉴 정렬 순서 */
    private Integer sortOrder;
    /** 메뉴 활성화 여부 */
    private Character available;
    /** 메뉴 접근 권한 */
    private Role accessRole;
}
