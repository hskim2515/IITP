package com.iitp.iitp_rest.handler;

import jakarta.xml.bind.ValidationEvent;
import jakarta.xml.bind.ValidationEventHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class XmlValidationEventHandler implements ValidationEventHandler {

    private static final Logger log = LoggerFactory.getLogger(XmlValidationEventHandler.class);

    @Override
    public boolean handleEvent(ValidationEvent event) {
        String severity = switch (event.getSeverity()) {
            case ValidationEvent.WARNING -> "WARNING";
            case ValidationEvent.ERROR -> "ERROR";
            case ValidationEvent.FATAL_ERROR -> "FATAL_ERROR";
            default -> "UNKNOWN";
        };

        log.error("JAXB Validation Event Occurred:");
        log.error("  - Severity: {}", severity);
        log.error("  - Message: {}", event.getMessage());
        if (event.getLocator() != null) {
            log.error("  - Location: Line {}, Column {}",
                    event.getLocator().getLineNumber(),
                    event.getLocator().getColumnNumber());
        }
        // WARNING/ERROR는 계속 진행, FATAL_ERROR만 중단
        return event.getSeverity() != ValidationEvent.FATAL_ERROR;
    }
}