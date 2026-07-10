package com.iitp.iitp_rest.util;

import java.io.IOException;
import java.io.InputStream;

public interface FileStorageService {
    /** basePath/{subDir}/{fileName} 에 저장 */
    void uploadFile(InputStream inputStream, String subDir, String fileName) throws IOException;
    /** basePath/{fileName} 에 저장 */
    void uploadFile(InputStream inputStream, String fileName) throws IOException;
    /** basePath/{subDir} 디렉토리 생성 */
    void createDirectory(String subDir) throws IOException;
    /** basePath/{fileName} 삭제 */
    void deleteFile(String fileName) throws IOException;
    /** basePath/{fileName} 읽기 — 파일이 없으면 IOException */
    byte[] readFile(String fileName) throws IOException;
    /** basePath/{fileName} 존재 여부 (파일 내용을 읽지 않고 확인) */
    boolean exists(String fileName);
}
