package com.iitp.iitp_rest.service.menu;

import com.iitp.iitp_rest.model.menu.Menu;
import com.iitp.iitp_rest.repository.MenuRepository;
import jakarta.persistence.EntityNotFoundException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@Transactional
@RequiredArgsConstructor
public class MenuServiceImpl implements MenuService {

    private final MenuRepository menuRepository;

    @Override
    @Transactional(readOnly = true)
    public List<Menu> getAllMenuList() {
        return menuRepository.findAll();
    }

    @Override
    @Transactional(readOnly = true)
    public List<Menu> getMenuListByDepth(Integer depth) {
        return menuRepository.findAllByDepthAndAvailableOrderBySortOrder(depth);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Menu> getMenuById(Long menuId) {
        return menuRepository.findByMenuIdOrderBySortOrder(menuId);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<Menu> getMenuByMenuCode(String menuCode) {
        return menuRepository.findByMenuCode(menuCode);
    }

    @Override
    public Menu createMenu(Menu menu, Long parentId, Long rootId) {
        if (menuRepository.findByMenuCodeAndAvailable(menu.getMenuCode()).isPresent()) {
            throw new IllegalStateException("Already existed menuCode: " + menu.getMenuCode());
        }

        updateParentAndRoot(menu, parentId, rootId);

        if (menu.getAvailable() == null) {
            menu.setAvailable("Y");
        }
        return menuRepository.save(menu);
    }

    @Override
    public List<Menu> createMenuList(List<Menu> menuList) {
        List<Menu> savedList = new ArrayList<>();
        for (Menu menu : menuList) {
            // createMenu의 로직을 재활용하되, parents 정보는 menu 객체 안에 이미 설정되어 있어야 함
            // 이 부분은 bulk insert 시의 정책에 따라 로직 보강이 필요할 수 있음
            Menu saved = createMenu(menu,
                    menu.getParents() != null ? menu.getParents().getMenuId() : null,
                    menu.getRoot() != null ? menu.getRoot().getMenuId() : null);
            savedList.add(saved);
        }
        return savedList;
    }

    @Override
    public Menu updateMenu(Long menuId, Menu updatedData, Long parentId, Long rootId) {
        Menu existingMenu = menuRepository.findById(menuId)
                .orElseThrow(() -> new EntityNotFoundException("Menu not found for id: " + menuId));

        // parents, root 정보 업데이트
        updateParentAndRoot(updatedData, parentId, rootId);

        // toBuilder를 사용하여 기존 ID를 유지하며 필드 업데이트
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
                .accessRole(updatedData.getAccessRole())
                .build();
        return menuRepository.save(updatedMenu);
    }

    @Override
    public List<Menu> updateMenuList(List<Menu> menusToUpdate) {
        List<Long> menuIds = menusToUpdate.stream().map(Menu::getMenuId).collect(Collectors.toList());
        Map<Long, Menu> existingMenuMap = menuRepository.findAllById(menuIds).stream()
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
                    .parents(incoming.getParents()) // bulk update 시 parents 객체는 이미 설정된 상태여야 함
                    .root(incoming.getRoot())
                    .depth(incoming.getDepth())
                    .sortOrder(incoming.getSortOrder())
                    .available(incoming.getAvailable())
                    .accessRole(incoming.getAccessRole())
                    .build();
            updatedList.add(updatedMenu);
        }
        return menuRepository.saveAll(updatedList);
    }

    @Override
    public void deleteMenu(Long menuId) {
        Menu menu = menuRepository.findById(menuId)
                .orElseThrow(() -> new EntityNotFoundException("Menu not found for id: " + menuId));
        menu.setAvailable("N"); // Soft delete
        menuRepository.save(menu);
    }

    // 중복 로직을 처리하는 private helper method
    private void updateParentAndRoot(Menu menu, Long parentId, Long rootId) {
        if (parentId != null) {
            Menu parent = menuRepository.findById(parentId)
                    .orElseThrow(() -> new EntityNotFoundException("Parent menu not found: " + parentId));
            menu.setParents(parent);
            menu.setDepth(parent.getDepth() + 1);

            // 부모의 root가 있으면 그걸, 없으면 부모 자신을 root로
            Menu root = parent.getRoot() != null ? parent.getRoot() : parent;
            menu.setRoot(root);
        } else {
            menu.setParents(null);
            menu.setDepth(0);
            menu.setRoot(null);
        }

        // rootId가 명시적으로 들어온 경우, 부모 관계와 별개로 root를 설정할 수 있음 (정책에 따라 조정)
        if (rootId != null && (parentId == null || !parentId.equals(rootId))) {
            Menu root = menuRepository.findById(rootId)
                    .orElseThrow(() -> new EntityNotFoundException("Root menu not found: " + rootId));
            menu.setRoot(root);
        }
    }
}