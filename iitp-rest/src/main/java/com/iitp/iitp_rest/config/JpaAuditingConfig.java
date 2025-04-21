package com.iitp.iitp_rest.config;


import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.domain.AuditorAware;
import org.springframework.data.jpa.repository.config.EnableJpaAuditing;
//import org.springframework.security.core.Authentication;
//import org.springframework.security.core.context.SecurityContextHolder;
import java.util.Optional;

@Configuration
@EnableJpaAuditing(auditorAwareRef = "auditorProvider")
public class JpaAuditingConfig {


    @Bean
    public AuditorAware<String> auditorProvider() {
        // TODO: Spring Security 사용 시, 아래 코드 활용
        // Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        // if (auth == null || !auth.isAuthenticated()
        //     || "guest".equals(auth.getPrincipal())) {
        //     return Optional.empty();
        // }
        // return Optional.of(auth.getName());

        return () -> Optional.empty();
    }
}