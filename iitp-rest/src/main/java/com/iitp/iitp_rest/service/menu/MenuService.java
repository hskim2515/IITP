package com.iitp.iitp_rest.service.menu;

import com.iitp.iitp_rest.model.menu.Menu;

import java.util.*;

public interface MenuService {

    public List<Menu> getAllMenuList();

    public List<Menu> getMenuListByDepth(Integer depth);

    public Optional<Menu> getMenuById(Long menuId);

    public Optional<Menu> getMenuByMenuCode(String menuCode);

    public List<Menu> getAvailableMenuList();

    public Menu createMenu(Menu menu);

    public List<Menu> createMenuList(List<Menu> menuList);

    public Menu updateMenu(Long menuId, Menu updatedData);

    public List<Menu> updateMenuList(List<Menu> menusToUpdate);

    public void deleteMenu(Long menuId);

}
