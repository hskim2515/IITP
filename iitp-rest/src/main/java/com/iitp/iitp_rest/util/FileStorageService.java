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
    /** basePath/{subDir} 디렉토리를 내용물 포함 통째로 삭제 (없으면 no-op) —
     *  시나리오 버전 삭제 시 그 버전 폴더의 모든 산출물(network.xml, signal.xml,
     *  odmatrix.xml, vehicle_sim.db 등)을 남기지 않기 위한 용도 */
    void deleteDirectory(String subDir) throws IOException;
    /** basePath/{fileName} 읽기 — 파일이 없으면 IOException */
    byte[] readFile(String fileName) throws IOException;
    /** basePath/{fileName} 존재 여부 (파일 내용을 읽지 않고 확인) */
    boolean exists(String fileName);
}
