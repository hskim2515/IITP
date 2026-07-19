package com.iitp.iitp_rest.util;

import com.jcraft.jsch.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

@Slf4j
@Service
@ConditionalOnProperty(name = "storage.type", havingValue = "sftp")
public class SftpFileStorageService implements FileStorageService {

    @Value("${sftp.host}")
    private String host;
    @Value("${sftp.port}")
    private int port;
    @Value("${sftp.user}")
    private String user;
    @Value("${sftp.password}")
    private String password;
    @Value("${sftp.base-path}")
    private String basePath;

    @Override
    public void uploadFile(InputStream inputStream, String subDir, String fileName) throws IOException {
        ChannelSftp ch = connect();
        try {
            String dirPath = basePath + subDir;
            mkdirRecursive(ch, dirPath);
            ch.put(inputStream, dirPath + "/" + fileName);
            log.info("SFTP upload: {}/{}", subDir, fileName);
        } catch (SftpException e) {
            throw new IOException("SFTP 업로드 실패: " + subDir + "/" + fileName, e);
        } finally {
            disconnect(ch);
        }
    }

    @Override
    public void uploadFile(InputStream inputStream, String fileName) throws IOException {
        ChannelSftp ch = connect();
        try {
            ch.cd(basePath);
            ch.put(inputStream, fileName);
        } catch (SftpException e) {
            throw new IOException("SFTP 업로드 실패: " + fileName, e);
        } finally {
            disconnect(ch);
        }
    }

    @Override
    public void createDirectory(String subDir) throws IOException {
        ChannelSftp ch = connect();
        try {
            ch.cd(basePath);
            ch.mkdir(subDir);
        } catch (SftpException e) {
            throw new IOException("SFTP 디렉토리 생성 실패: " + subDir, e);
        } finally {
            disconnect(ch);
        }
    }

    @Override
    public void deleteFile(String fileName) throws IOException {
        ChannelSftp ch = connect();
        try {
            ch.rm(basePath + fileName);
        } catch (SftpException e) {
            throw new IOException("SFTP 파일 삭제 실패: " + fileName, e);
        } finally {
            disconnect(ch);
        }
    }

    @Override
    public byte[] readFile(String fileName) throws IOException {
        ChannelSftp ch = connect();
        try {
            ch.cd(basePath); // 인터페이스 규약: basePath/{fileName} — 누락 시 로그인 홈 기준 상대 해석
            java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
            ch.get(fileName, baos);
            return baos.toByteArray();
        } catch (SftpException e) {
            throw new IOException("SFTP 읽기 실패: " + fileName, e);
        } finally {
            disconnect(ch);
        }
    }

    @Override
    public boolean exists(String fileName) {
        ChannelSftp ch = null;
        try {
            ch = connect();
            // basePath 기준 — 없으면 로그인 홈 기준 상대 해석돼 항상 false
            // (NextSim 스테이징이 SFTP 스토리지에서 network.xml 을 못 찾던 원인)
            ch.cd(basePath);
            ch.stat(fileName);
            return true;
        } catch (Exception e) {
            return false;
        } finally {
            disconnect(ch);
        }
    }

    private void mkdirRecursive(ChannelSftp ch, String path) throws SftpException {
        try {
            ch.stat(path);
        } catch (SftpException e) {
            if (e.id == ChannelSftp.SSH_FX_NO_SUCH_FILE) {
                int slash = path.lastIndexOf('/');
                if (slash > 0) mkdirRecursive(ch, path.substring(0, slash));
                ch.mkdir(path);
            } else {
                throw e;
            }
        }
    }

    private ChannelSftp connect() throws IOException {
        try {
            JSch jsch = new JSch();
            Session session = jsch.getSession(user, host, port);
            session.setPassword(password);
            Properties config = new Properties();
            config.put("StrictHostKeyChecking", "no");
            session.setConfig(config);
            session.connect();
            Channel channel = session.openChannel("sftp");
            channel.connect();
            return (ChannelSftp) channel;
        } catch (JSchException e) {
            throw new IOException("SFTP 연결 실패", e);
        }
    }

    private void disconnect(ChannelSftp ch) {
        if (ch == null) return;
        try {
            Session session = ch.getSession();
            ch.exit();
            if (session != null && session.isConnected()) session.disconnect();
        } catch (JSchException ignored) {}
    }
}
