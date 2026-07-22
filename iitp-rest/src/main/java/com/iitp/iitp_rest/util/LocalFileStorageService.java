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
    public void deleteDirectory(String subDir) throws IOException {
        if (subDir == null || subDir.isBlank() || subDir.contains("..")) {
            throw new IOException("잘못된 디렉토리 경로: " + subDir);
        }
        Path dir = Paths.get(basePath, subDir);
        if (!Files.exists(dir)) return;
        // 하위 파일부터 역순 삭제 (walk 는 부모 → 자식 순이므로 reverse)
        try (java.util.stream.Stream<Path> walk = Files.walk(dir)) {
            java.util.List<Path> paths = walk.sorted(java.util.Comparator.reverseOrder()).toList();
            for (Path p : paths) Files.deleteIfExists(p);
        }
        log.info("로컬 디렉토리 삭제: {}", dir);
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
