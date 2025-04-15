package com.iitp.iitp_rest.service.menu;

import com.iitp.iitp_rest.model.menu.Menu;
import com.iitp.iitp_rest.model.menu.MenuTreeDTO;
import com.iitp.iitp_rest.repository.MenuRepository;

import jakarta.persistence.EntityNotFoundException;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@Transactional
@RequiredArgsConstructor
public class MenuService {

    private final MenuRepository menuRepository;

    @Transactional(propagation = Propagation.SUPPORTS)
    public List<Menu> getAllMenuList() {
        return menuRepository.findAll();
    }


    @Transactional(propagation = Propagation.SUPPORTS)
    public List<Menu> getMenuListByDepth(Integer depth) {
        return menuRepository.findAllByDepthAndAvailableOrderBySortOrder(depth);
    }

    @Transactional(propagation = Propagation.SUPPORTS)
    public Optional<Menu> getMenuById(Long menuId) {
        return menuRepository.findByMenuIdOrderBySortOrder(menuId);
    }

    @Transactional(propagation = Propagation.SUPPORTS)
    public List<Menu> getAvailableMenuList() {
        return menuRepository.findAllByAvailableOrderBySortOrder();
    }

    // 단일 메뉴 생성
    public Menu createMenu(Menu menu) {
        if (menu.getParents() == null) {
            // 최고 부모의 경우 depth 0으로 설정
            menu.setDepth(0);
        } else {
            // 부모 메뉴가 존재하면, 예: 부모 depth + 1 계산
            menu.setDepth(menu.getParents().getDepth() + 1);
        }
        if (menu.getAvailable() == null) {
            menu.setAvailable('Y');  // 기본적으로 활성 상태
        }
        return menuRepository.save(menu);
    }

    // 여러 메뉴 생성 (bulk insert)
    public List<Menu> createMenuList(List<Menu> menuList) {
        menuList.forEach(menu -> {
            if (menu.getParents() == null) {
                menu.setDepth(0);
            } else {
                // 부모 메뉴가 있다면, 부모의 depth + 1로 설정하는 예시
                menu.setDepth(menu.getParents().getDepth() + 1);
            }
            if (menu.getAvailable() == null) {
                menu.setAvailable('Y');
            }
        });
        return menuRepository.saveAll(menuList);
    }

    public Menu updateMenu(Long menuId, Menu updatedData) {
        Menu existingMenu = menuRepository.findById(menuId)
                .orElseThrow(() -> new EntityNotFoundException("Menu not found for id: " + menuId));

        Menu updatedMenu = existingMenu.toBuilder()
                .language(updatedData.getLanguage())
                .nameKor(updatedData.getNameKor())
                .nameEn(updatedData.getNameEn())
                .parents(updatedData.getParents())
                .depth(updatedData.getDepth())
                .sortOrder(updatedData.getSortOrder())
                .available(updatedData.getAvailable())
                .build();
        return menuRepository.save(updatedMenu);
    }

    public List<Menu> updateMenuList(List<Menu> menusToUpdate) {
        // 업데이트할 메뉴들의 ID 목록을 추출
        List<Long> menuIds = menusToUpdate.stream()
                .map(Menu::getMenuId)
                .collect(Collectors.toList());

        // DB에서 해당 메뉴들을 조회
        List<Menu> existingMenus = menuRepository.findAllById(menuIds);
        Map<Long, Menu> existingMenuMap = existingMenus.stream()
                .collect(Collectors.toMap(Menu::getMenuId, Function.identity()));

        List<Menu> updatedList = new ArrayList<>();
        for (Menu incoming : menusToUpdate) {
            Menu existing = existingMenuMap.get(incoming.getMenuId());
            if (existing == null) {
                throw new EntityNotFoundException("Menu not found for id: " + incoming.getMenuId());
            }
            // 기존 메뉴의 모든 필드를 복사한 후 업데이트할 부분을 재설정
            Menu updatedMenu = existing.toBuilder()
                    .language(incoming.getLanguage())
                    .nameKor(incoming.getNameKor())
                    .nameEn(incoming.getNameEn())
                    .parents(incoming.getParents())
                    .depth(incoming.getDepth())
                    .sortOrder(incoming.getSortOrder())
                    .available(incoming.getAvailable())
                    .build();
            updatedList.add(updatedMenu);
        }

        return menuRepository.saveAll(updatedList);
    }

    public void deleteMenu(Long menuId) {
        Menu menu = menuRepository.findById(menuId)
                .orElseThrow(() -> new EntityNotFoundException("Menu not found for id: " + menuId));
        menu.setAvailable('N');
        menuRepository.save(menu);
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
            dto.setLanguage(menu.getLanguage());
            dto.setNameKor(menu.getNameKor());
            dto.setNameEn(menu.getNameEn());
            dto.setDepth(menu.getDepth());
            dto.setSortOrder(menu.getSortOrder());
            dto.setAvailable(menu.getAvailable());
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
