package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.menu.MenuMapper;
import com.iitp.iitp_rest.model.menu.MenuRequest;
import com.iitp.iitp_rest.model.menu.MenuResponse;
import com.iitp.iitp_rest.model.menu.MenuTreeResponse;
import com.iitp.iitp_rest.model.menu.Menu;
import com.iitp.iitp_rest.service.menu.MenuService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/menu")
@RequiredArgsConstructor
public class MenuController {

    private final MenuService menuService;
    private final MenuMapper menuMapper;

    @PostMapping
    public ResponseEntity<MenuResponse> createMenu(@RequestBody MenuRequest menuRequest) {
        Menu menu = menuMapper.toEntity(menuRequest);
        Menu createdMenu = menuService.createMenu(menu, menuRequest.getParentsId(), menuRequest.getRootId());
        return new ResponseEntity<>(menuMapper.toResponse(createdMenu), HttpStatus.CREATED);
    }

    @GetMapping("/{menuId}")
    public ResponseEntity<MenuResponse> getMenuById(@PathVariable Long menuId) {
        return menuService.getMenuById(menuId)
                .map(menuMapper::toResponse)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @PutMapping("/{menuId}")
    public ResponseEntity<MenuResponse> updateMenuById(@PathVariable Long menuId, @RequestBody MenuRequest menuRequest) {
        Menu menu = menuMapper.toEntity(menuRequest);
        Menu updatedMenu = menuService.updateMenu(menuId, menu, menuRequest.getParentsId(), menuRequest.getRootId());
        return ResponseEntity.ok(menuMapper.toResponse(updatedMenu));
    }

    @DeleteMapping("/{menuId}")
    public ResponseEntity<Void> deleteMenuById(@PathVariable Long menuId) {
        menuService.deleteMenu(menuId);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/list")
    public ResponseEntity<List<MenuResponse>> getMenus() {
        List<Menu> menuList = menuService.getAllMenuList();
        return ResponseEntity.ok(menuMapper.toResponseList(menuList));
    }

    @PostMapping("/list")
    public ResponseEntity<List<MenuResponse>> createMenus(@RequestBody List<MenuRequest> menuRequests) {
        List<Menu> entityList = menuRequests.stream()
                .map(menuMapper::toEntity)
                .collect(Collectors.toList());
        List<Menu> createdEntityList = menuService.createMenuList(entityList);
        return new ResponseEntity<>(menuMapper.toResponseList(createdEntityList), HttpStatus.CREATED);
    }

    @PutMapping("/list")
    public ResponseEntity<List<MenuResponse>> updateMenus(@RequestBody List<MenuResponse> menuResponses) {
        List<Menu> entityList = menuResponses.stream()
                .map(menuMapper::toEntityFromResponse)
                .collect(Collectors.toList());
        List<Menu> updatedEntityList = menuService.updateMenuList(entityList);
        return ResponseEntity.ok(menuMapper.toResponseList(updatedEntityList));
    }

    @GetMapping("/code/{menuCode}")
    public ResponseEntity<MenuResponse> getMenuByCode(@PathVariable String menuCode) {
        return menuService.getMenuByMenuCode(menuCode)
                .map(menuMapper::toResponse)
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/depth/{depth}")
    public ResponseEntity<List<MenuResponse>> getMenusByDepth(@PathVariable Integer depth) {
        List<Menu> menuList = menuService.getMenuListByDepth(depth);
        return ResponseEntity.ok(menuMapper.toResponseList(menuList));
    }

    @GetMapping("/tree")
    public ResponseEntity<List<MenuTreeResponse>> getMenuTree() {
        List<Menu> menuList = menuService.getAllMenuList();
        List<MenuTreeResponse> treeResponse = menuMapper.toTreeResponse(menuList);
        return ResponseEntity.ok(treeResponse);
    }

}