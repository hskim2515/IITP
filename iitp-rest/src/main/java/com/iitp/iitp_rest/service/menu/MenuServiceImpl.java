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
public class MenuServiceImpl implements MenuService{

    private final MenuRepository menuRepository;

    @Override
    @Transactional(propagation = Propagation.SUPPORTS)
    public List<Menu> getAllMenuList() {
        return menuRepository.findAll();
    }

    @Override
    @Transactional(propagation = Propagation.SUPPORTS)
    public List<Menu> getMenuListByDepth(Integer depth) {
        return menuRepository.findAllByDepthAndAvailableOrderBySortOrder(depth);
    }

    @Override
    @Transactional(propagation = Propagation.SUPPORTS)
    public Optional<Menu> getMenuById(Long menuId) {
        return menuRepository.findByMenuIdOrderBySortOrder(menuId);
    }

    @Override
    @Transactional(propagation = Propagation.SUPPORTS)
    public Optional<Menu> getMenuByMenuCode(String menuCode) {
        return menuRepository.findByMenuCode(menuCode);
    }

    @Override
    @Transactional(propagation = Propagation.SUPPORTS)
    public List<Menu> getAvailableMenuList() {
        return menuRepository.findAllByAvailableOrderBySortOrder();
    }


    // 단일 메뉴 생성
    @Override
    public Menu createMenu(Menu menu) {
        if (menuRepository.findByMenuCodeAndAvailable(menu.getMenuCode()).isPresent()) {
            throw new IllegalStateException("Already existed menuCode: " + menu.getMenuCode());
        }
        if (menu.getParents() == null) {
            // 최고 부모의 경우 depth 0으로 설정
            menu.setDepth(0);
            menu.setRoot(null);
        } else {
            // 부모 정보 새로 조회하여 depth, root 결정
            Menu parent = menuRepository.findById(menu.getParents().getMenuId())
                    .orElseThrow(() -> new EntityNotFoundException("Parents Menu not found for id: " + menu.getParents().getMenuId()));

            menu.setDepth(parent.getDepth() + 1);

            // 부모의 root가 있으면 그걸, 없으면 부모 자신을 root로
            Menu root = parent.getRoot() != null ? parent.getRoot() : parent;
            menu.setRoot(root);
        }
        if (menu.getAvailable() == null) {
            menu.setAvailable('Y');  // 기본적으로 활성 상태
        }

        return menuRepository.save(menu);
    }

    // 여러 메뉴 생성 (bulk insert)
    @Override
    public List<Menu> createMenuList(List<Menu> menuList) {
        List<Menu> saved = new ArrayList<>();
        for (Menu m : menuList) {
            saved.add(createMenu(m));
        }
        return saved;
    }

    @Override
    public Menu updateMenu(Long menuId, Menu updatedData) {
        Menu existingMenu = menuRepository.findByMenuIdOrderBySortOrder(menuId)
                .orElseThrow(() -> new EntityNotFoundException("Menu not found for id: " + menuId));

        Menu updatedMenu = existingMenu.toBuilder()
                .menuCode(updatedData.getMenuCode())
                .language(updatedData.getLanguage())
                .nameKor(updatedData.getNameKor())
                .nameEn(updatedData.getNameEn())
                .parents(updatedData.getParents())
                .root(updatedData.getRoot())
                .depth(updatedData.getDepth())
                .sortOrder(updatedData.getSortOrder())
                .available(updatedData.getAvailable())
                .build();
        return menuRepository.save(updatedMenu);
    }

    @Override
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
                    .menuCode(incoming.getMenuCode())
                    .language(incoming.getLanguage())
                    .nameKor(incoming.getNameKor())
                    .nameEn(incoming.getNameEn())
                    .parents(incoming.getParents())
                    .root(incoming.getRoot())
                    .depth(incoming.getDepth())
                    .sortOrder(incoming.getSortOrder())
                    .available(incoming.getAvailable())
                    .build();
            updatedList.add(updatedMenu);
        }

        return menuRepository.saveAll(updatedList);
    }

    @Override
    public void deleteMenu(Long menuId) {
        Menu menu = menuRepository.findByMenuIdOrderBySortOrder(menuId)
                .orElseThrow(() -> new EntityNotFoundException("Menu not found for id: " + menuId));
        menu.setAvailable('N');
        menuRepository.save(menu);
    }

}
