package com.iitp.iitp_rest.util;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;

@Slf4j
@Service
@ConditionalOnProperty(name = "storage.type", havingValue = "local", matchIfMissing = true)
public class LocalFileStorageService implements FileStorageService {

    @Value("${iitp.local.data-path:${user.home}/.iitp-local/models}")
    private String basePath;

    @Override
    public void uploadFile(InputStream inputStream, String subDir, String fileName) throws IOException {
        Path dir = Paths.get(basePath, subDir);
        Files.createDirectories(dir);
        Path target = dir.resolve(fileName);
        Files.copy(inputStream, target, StandardCopyOption.REPLACE_EXISTING);
        log.info("로컬 저장: {}", target);
    }

    @Override
    public void uploadFile(InputStream inputStream, String fileName) throws IOException {
        Path dir = Paths.get(basePath);
        Files.createDirectories(dir);
        Path target = dir.resolve(fileName);
        Files.createDirectories(target.getParent());
        Files.copy(inputStream, target, StandardCopyOption.REPLACE_EXISTING);
        log.info("로컬 저장: {}", target);
    }

    @Override
    public void createDirectory(String subDir) throws IOException {
        Path dir = Paths.get(basePath, subDir);
        Files.createDirectories(dir);
        log.info("로컬 디렉토리 생성: {}", dir);
    }

    @Override
    public void deleteFile(String fileName) throws IOException {
        Path target = Paths.get(basePath, fileName);
        Files.deleteIfExists(target);
        log.info("로컬 파일 삭제: {}", target);
    }

    @Override
    public byte[] readFile(String fileName) throws IOException {
        Path target = Paths.get(basePath, fileName);
        return Files.readAllBytes(target);
    }

    @Override
    public boolean exists(String fileName) {
        return Files.exists(Paths.get(basePath, fileName));
    }
}
