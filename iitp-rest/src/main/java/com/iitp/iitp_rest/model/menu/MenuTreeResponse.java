package com.iitp.iitp_rest.model.menu;

import com.iitp.iitp_rest.model.role.Role;
import lombok.Data;
import java.util.ArrayList;
import java.util.List;

@Data
public class MenuTreeResponse {
    private Long menuId;
    private String menuCode;
    private String language;
    private String nameKor;
    private String nameEn;
    private Integer depth;
    private Integer sortOrder;
    private Character available;
    private Role accessRole;
    // 자식 노드를 담는 리스트 (초기에는 빈 리스트)
    private List<MenuTreeResponse> children = new ArrayList<>();
    private Long rootId;
}