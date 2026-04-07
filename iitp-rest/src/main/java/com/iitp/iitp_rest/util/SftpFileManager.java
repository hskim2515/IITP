package com.iitp.iitp_rest.util;

import com.jcraft.jsch.*;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

@Slf4j
@Component
public class SftpFileManager {

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

    public void uploadFile(InputStream inputStream, String remoteFileName) throws IOException, JSchException {
        ChannelSftp channelSftp = getSftpChannel();

        try {
            channelSftp.cd(basePath);
            channelSftp.put(inputStream, remoteFileName);
        } catch (SftpException e) {
            throw new IOException("SFTP 파일 업로드 실패", e);
        } finally {
            disconnect(channelSftp);
        }
    }

    public void uploadFile(InputStream inputStream, String subDir, String fileName) throws IOException, JSchException {
        ChannelSftp channelSftp = getSftpChannel();

        try {
            String absolutePath = basePath + subDir + "/" + fileName;
            log.info("SFTP put 시도: basePath={}, subDir={}, absolutePath={}", basePath, subDir, absolutePath);
            channelSftp.put(inputStream, absolutePath);
        } catch (SftpException e) {
            throw new IOException("SFTP 파일 업로드 실패", e);
        } finally {
            disconnect(channelSftp);
        }
    }

    public void createDirectory(String dirName) throws IOException, JSchException {
        ChannelSftp channelSftp = getSftpChannel();
        try {
            channelSftp.cd(basePath);
            channelSftp.mkdir(dirName);
        } catch (SftpException e) {
            throw new IOException("SFTP 디렉토리 생성 실패: " + dirName, e);
        } finally {
            disconnect(channelSftp);
        }
    }

    public void deleteFile(String remoteFilePath) throws IOException, JSchException {
        ChannelSftp channelSftp = getSftpChannel();

        try {
            channelSftp.rm(remoteFilePath);
        } catch (SftpException e) {
            throw new IOException("SFTP 파일 삭제 실패", e);
        } finally {
            disconnect(channelSftp);
        }
    }

    private ChannelSftp getSftpChannel() throws IOException {
        JSch jsch = new JSch();
        Session session;

        try {
            session = jsch.getSession(user, host, port);
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

    private void disconnect(ChannelSftp channelSftp) throws JSchException {
        if (channelSftp != null) {
            Session session = channelSftp.getSession();
            channelSftp.exit();
            if (session != null && session.isConnected()) {
                session.disconnect();
            }
        }
    }
}
