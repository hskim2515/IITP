FROM eclipse-temurin:23-jdk

ARG SPRING_PROFILES_ACTIVE
ENV SPRING_PROFILES_ACTIVE=${SPRING_PROFILES_ACTIVE}

EXPOSE 9090

ADD ./build/libs/*.jar app.jar

ENTRYPOINT ["java", "-XX:InitialRAMPercentage=50.0", "-XX:MaxRAMPercentage=50.0", "-jar", "/app.jar"]