package com.iitp.iitp_rest.controller;

import com.iitp.iitp_rest.mapper.menu.MenuMapper;
import com.iitp.iitp_rest.model.menu.Menu;
import com.iitp.iitp_rest.model.menu.MenuTreeDTO;
import com.iitp.iitp_rest.service.menu.MenuService;
import com.iitp.iitp_rest.model.menu.MenuDTO;
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

    // 단일 메뉴 생성 (Create a single Menu)
    @PostMapping
    public ResponseEntity<MenuDTO> createMenu(@RequestBody MenuDTO dto) {
        Menu entity = menuMapper.toEntity(dto);
        Menu createdEntity = menuService.createMenu(entity);
        // 엔티티를 DTO로 변환하여 반환
        MenuDTO createdDto = menuMapper.toDTO(createdEntity);
        return new ResponseEntity<>(createdDto, HttpStatus.CREATED);
    }

    // 다중 메뉴 생성 (Bulk creation of Menus)
    @PostMapping("/bulk")
    public ResponseEntity<List<MenuDTO>> createMenuList(@RequestBody List<MenuDTO> dtoList) {
        List<Menu> entityList = dtoList.stream()
                .map(menuMapper::toEntity)
                .collect(Collectors.toList());
        List<Menu> createdEntityList = menuService.createMenuList(entityList);
        // 각 엔티티를 DTO로 변환하여 반환
        List<MenuDTO> createdDtoList = createdEntityList.stream()
                .map(menuMapper::toDTO)
                .collect(Collectors.toList());
        return new ResponseEntity<>(createdDtoList, HttpStatus.CREATED);
    }

    // 단일 메뉴 조회 (Get a single Menu by ID)
    @GetMapping("/id/{menuId}")
    public ResponseEntity<MenuDTO> getMenuById(@PathVariable Long menuId) {
        return menuService.getMenuById(menuId)
                .map(menu -> ResponseEntity.ok(menuMapper.toDTO(menu)))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    // depth에 따른 메뉴 조회 (Get Menus by depth)
    @GetMapping("/depth/{depth}")
    public ResponseEntity<List<MenuDTO>> getMenuByDepth(@PathVariable Integer depth) {
        List<Menu> menuList = menuService.getMenuListByDepth(depth);
        List<MenuDTO> dtoList = menuList.stream()
                .map(menuMapper::toDTO)
                .collect(Collectors.toList());
        return ResponseEntity.ok(dtoList);
    }

    // 전체 메뉴 조회 (Get all Menus)
    @GetMapping
    public ResponseEntity<List<MenuDTO>> getAllMenuList() {
        List<Menu> menuList = menuService.getAllMenuList();
        List<MenuDTO> dtoList = menuList.stream()
                .map(menuMapper::toDTO)
                .collect(Collectors.toList());
        return ResponseEntity.ok(dtoList);
    }

    // 전체 메뉴 조회 (Get all Menus)
    @GetMapping("/tree")
    public ResponseEntity<List<MenuTreeDTO>> getAllMenuTree() {
        List<Menu> menuList = menuService.getAllMenuList();
        List<MenuTreeDTO> dtoTree = menuService.toTreeDTO(menuList);
        return ResponseEntity.ok(dtoTree);
    }
    // 다중 메뉴 업데이트 (Bulk update Menus)
    @PutMapping("/bulk")
    public ResponseEntity<List<MenuDTO>> updateMenuList(@RequestBody List<MenuDTO> dtoList) {
        List<Menu> entityList = dtoList.stream()
                .map(menuMapper::toEntity)
                .collect(Collectors.toList());
        List<Menu> updatedEntityList = menuService.updateMenuList(entityList);
        List<MenuDTO> updatedDtoList = updatedEntityList.stream()
                .map(menuMapper::toDTO)
                .collect(Collectors.toList());
        return ResponseEntity.ok(updatedDtoList);
    }

    // 단일 메뉴 업데이트 (Update a single Menu)
    @PutMapping("/{menuId}")
    public ResponseEntity<MenuDTO> updateMenu(@PathVariable Long menuId, @RequestBody MenuDTO dto) {
        Menu entity = menuMapper.toEntity(dto);
        Menu updatedEntity = menuService.updateMenu(menuId, entity);
        MenuDTO updatedDto = menuMapper.toDTO(updatedEntity);
        return ResponseEntity.ok(updatedDto);
    }

    // 메뉴 삭제 (soft delete) (Delete a Menu softly)
    @DeleteMapping("/{menuId}")
    public ResponseEntity<Void> deleteMenu(@PathVariable Long menuId) {
        menuService.deleteMenu(menuId);
        return ResponseEntity.noContent().build();
    }
}
