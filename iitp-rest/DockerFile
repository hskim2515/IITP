FROM openjdk:22-jdk

EXPOSE 9090

ADD ./build/libs/*.jar app.jar

ENTRYPOINT ["java", "-XX:InitialRAMPercentage=50.0", "-XX:MaxRAMPercentage=50.0","-jar","/app.jar"]