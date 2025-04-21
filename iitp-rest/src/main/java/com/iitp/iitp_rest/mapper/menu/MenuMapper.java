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
        Menu parent = null;
        if (dto.getParentsId() != null) {
            parent = menuRepository.findByMenuIdOrderBySortOrder(dto.getParentsId())
                    .orElseThrow(() -> new IllegalArgumentException("부모 메뉴가 존재하지 않습니다. id: " + dto.getParentsId()));
        }

        Menu root = null;
        if (dto.getRootId() != null) {
            root = menuRepository.findById(dto.getRootId())
                    .orElseThrow(() -> new IllegalArgumentException("루트 메뉴가 존재하지 않습니다. id: " + dto.getRootId()));
        }

        return Menu.builder()
                .menuCode(dto.getMenuCode())
                .language(dto.getLanguage())
                .nameKor(dto.getNameKor())
                .nameEn(dto.getNameEn())
                .parents(parent)
                .root(root)
                .depth(dto.getDepth())
                .sortOrder(dto.getSortOrder())
                .available(dto.getAvailable())
                .accessRole(dto.getAccessRole())
                .build();
    }

    public MenuDTO toDTO(Menu menu) {
        MenuDTO dto = new MenuDTO();
        dto.setMenuId(menu.getMenuId());
        dto.setMenuCode(menu.getMenuCode());
        dto.setLanguage(menu.getLanguage());
        dto.setNameKor(menu.getNameKor());
        dto.setNameEn(menu.getNameEn());
        dto.setDepth(menu.getDepth());
        dto.setSortOrder(menu.getSortOrder());
        dto.setAvailable(menu.getAvailable());
        dto.setAccessRole(menu.getAccessRole());
        if (menu.getParents() != null) {
            dto.setParentsId(menu.getParents().getMenuId());
        }
        if (menu.getRoot() != null) {
            dto.setRootId(menu.getRoot().getMenuId());  // ← 추가
        }

        return dto;
    }

    public List<MenuTreeDTO> toTreeDTO(List<Menu> menuList) {
        // menuId를 키로 하여 각 메뉴 DTO를 저장할 Map
        Map<Long, MenuTreeDTO> idToDto = new HashMap<>();
        // 최상위 메뉴(부모가 없는 메뉴)를 담을 리스트
        List<MenuTreeDTO> roots = new ArrayList<>();

        // 각 메뉴 엔티티를 MenuTreeDTO로 변환하여 Map에 저장
        for (Menu menu : menuList) {
            MenuTreeDTO dto = new MenuTreeDTO();
            dto.setMenuId(menu.getMenuId());
            dto.setMenuCode(menu.getMenuCode());
            dto.setLanguage(menu.getLanguage());
            dto.setNameKor(menu.getNameKor());
            dto.setNameEn(menu.getNameEn());
            dto.setDepth(menu.getDepth());
            dto.setSortOrder(menu.getSortOrder());
            dto.setAvailable(menu.getAvailable());
            dto.setAccessRole(menu.getAccessRole());
            if (menu.getRoot() != null) {
                dto.setRootId(menu.getRoot().getMenuId());
            }
            idToDto.put(menu.getMenuId(), dto);
        }

        // 각 Menu 객체의 parentsId를 확인하여 트리 구조로 구성
        for (Menu menu : menuList) {
            MenuTreeDTO dto = idToDto.get(menu.getMenuId());
            if (menu.getParents() != null) {
                Long parentId = menu.getParents().getMenuId();
                MenuTreeDTO parentDto = idToDto.get(parentId);
                if (parentDto != null) {
                    parentDto.getChildren().add(dto);
                }
            } else {
                // 부모가 없는 메뉴는 최상위 노드
                roots.add(dto);
            }
        }

        // 선택적: 각 단계별 정렬 (예: sortOrder 기준)
        sortMenuTree(roots);

        return roots;
    }

    // 재귀적으로 각 자식 리스트를 정렬하는 메서드 예시
    private void sortMenuTree(List<MenuTreeDTO> dtoList) {
        if (dtoList == null || dtoList.isEmpty()) {
            return;
        }
        dtoList.sort(Comparator.comparing(MenuTreeDTO::getSortOrder));
        for (MenuTreeDTO dto : dtoList) {
            sortMenuTree(dto.getChildren());
        }
    }
}
