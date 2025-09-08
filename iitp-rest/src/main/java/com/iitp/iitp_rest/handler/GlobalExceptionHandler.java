package com.iitp.iitp_rest.handler;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.time.Instant;

@RestControllerAdvice(basePackages = {"com.iitp.iitp_rest.controller"})
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ResponseStatusException.class)
    public ProblemDetail handleResponseStatus(ResponseStatusException ex, HttpServletRequest req) {
        HttpStatus status = HttpStatus.resolve(ex.getStatusCode().value());
        if (status == null) status = HttpStatus.INTERNAL_SERVER_ERROR;

        ProblemDetail pd = ProblemDetail.forStatusAndDetail(status, safe(ex.getReason(), ex.getMessage()));
        pd.setTitle(status.getReasonPhrase());
        pd.setType(URI.create("about:blank"));
        pd.setInstance(URI.create(req.getRequestURI()));
        enrich(pd, req, "response_status");

        if (status.is4xxClientError()) {
            log.warn("[response_status] {} {} -> {} | {}",
                    req.getMethod(), req.getRequestURI(), status, pd.getDetail());
        } else {
            log.error("[response_status] {} {} -> {} | {}",
                    req.getMethod(), req.getRequestURI(), status, pd.getDetail(), ex);
        }
        return pd;
    }

    @ExceptionHandler(Exception.class)
    public ProblemDetail handleAny(Exception ex, HttpServletRequest req) {
        HttpStatus status = HttpStatus.INTERNAL_SERVER_ERROR;
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(status,
                (ex.getMessage() == null || ex.getMessage().isBlank()) ? "Unexpected error." : ex.getMessage());
        pd.setTitle(status.getReasonPhrase());
        pd.setType(URI.create("about:blank"));
        pd.setInstance(URI.create(req.getRequestURI()));
        enrich(pd, req, "internal_error");
        log.error("[internal_error] {} {} -> {} | {}", req.getMethod(), req.getRequestURI(), status, pd.getDetail(), ex);
        return pd;
    }

    private static String safe(String... candidates) {
        for (String c : candidates) {
            if (c != null && !c.isBlank()) return c;
        }
        return "Error";
    }

    private static void enrich(ProblemDetail pd, HttpServletRequest req, String errorCode) {
        pd.setProperty("timestamp", Instant.now().toString());
        pd.setProperty("path", req.getRequestURI());
        pd.setProperty("errorCode", errorCode);
    }
}
