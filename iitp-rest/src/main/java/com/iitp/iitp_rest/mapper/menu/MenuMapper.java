package com.iitp.iitp_rest.mapper.menu;

import com.iitp.iitp_rest.model.menu.Menu;
import com.iitp.iitp_rest.model.menu.MenuDTO;
import com.iitp.iitp_rest.model.menu.MenuTreeDTO;
import com.iitp.iitp_rest.repository.MenuRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.*;

@Component
@RequiredArgsConstructor
public class MenuMapper {

    private final MenuRepository menuRepository;

    public Menu toEntity(MenuDTO dto) {
        Menu parentMenu = null;
        if(dto.getParentsId() != null) {
            Long menuId = dto.getParentsId();
            parentMenu = menuRepository.findByMenuIdOrderBySortOrder(dto.getParentsId())
                    .orElseThrow(() -> new IllegalArgumentException("부모 메뉴가 존재하지 않습니다. id: " + dto.getParentsId()));
        }

        return Menu.builder()
                .language(dto.getLanguage())
                .nameKor(dto.getNameKor())
                .nameEn(dto.getNameEn())
                .parents(parentMenu)
                .depth(dto.getDepth())
                .sortOrder(dto.getSortOrder())
                .available(dto.getAvailable())
                .build();
    }

    public MenuDTO toDTO(Menu menu) {
        MenuDTO dto = new MenuDTO();
        dto.setMenuId(menu.getMenuId());
        dto.setLanguage(menu.getLanguage());
        dto.setNameKor(menu.getNameKor());
        dto.setNameEn(menu.getNameEn());
        dto.setDepth(menu.getDepth());
        dto.setSortOrder(menu.getSortOrder());
        dto.setAvailable(menu.getAvailable());
        if(menu.getParents() != null) {
            dto.setParentsId(menu.getParents().getMenuId());
        }
        return dto;
    }
}
