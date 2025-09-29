package com.iitp.iitp_rest.service.menu;

import com.iitp.iitp_rest.model.menu.Menu;
import java.util.List;
import java.util.Optional;

public interface MenuService {

    List<Menu> getAllMenuList();
    List<Menu> getMenuListByDepth(Integer depth);
    Optional<Menu> getMenuById(Long menuId);
    Optional<Menu> getMenuByMenuCode(String menuCode);

    Menu createMenu(Menu menu, Long parentId, Long rootId);
    List<Menu> createMenuList(List<Menu> menuList);

    Menu updateMenu(Long menuId, Menu updatedData, Long parentId, Long rootId);
    List<Menu> updateMenuList(List<Menu> menusToUpdate);

    void deleteMenu(Long menuId);
}