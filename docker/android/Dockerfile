# ChatHouse — Dockerized Android APK builder.
#
# Lets anyone with ONLY Docker installed build a self-contained ChatHouse APK —
# no local JDK, Android SDK/NDK, or Node.js required on the host. Driven by
# docker-compose.apk.yml (repo root) / scripts/build-apk.*.
#
# Toolchain pinned to what android/build.gradle + the Gradle wrapper expect:
#   JDK 17 · Android SDK 36 · build-tools 36.0.0 · NDK 27.1.12297006 · CMake 3.22.1
#   Node 22 (the RN Gradle plugin and sentry.gradle shell out to `node`)
FROM eclipse-temurin:17-jdk-jammy

ENV DEBIAN_FRONTEND=noninteractive

# Node 22 + build helpers. rsync copies the mounted source into a writable work
# dir; git is used by some npm postinstall tooling; python3 is a common gyp dep.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl unzip git rsync ca-certificates python3 && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ─── Android SDK command-line tools ──────────────────────────────────────────
ENV ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH=${PATH}:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools

# Bump this if a newer SDK platform isn't yet resolvable by these tools. Any
# recent build resolves platforms/android-36 fine (the API level is not gated by
# the cmdline-tools version — sdkmanager downloads whatever the repo offers).
ARG CMDLINE_TOOLS_VERSION=11076708
RUN mkdir -p ${ANDROID_HOME}/cmdline-tools && \
    curl -fsSL -o /tmp/cmdtools.zip \
      "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_VERSION}_latest.zip" && \
    unzip -q /tmp/cmdtools.zip -d ${ANDROID_HOME}/cmdline-tools && \
    mv ${ANDROID_HOME}/cmdline-tools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest && \
    rm /tmp/cmdtools.zip

# Accept all licenses, then install the exact SDK packages the project pins.
# NOTE: AGP 8.12's default build-tools for native-module subprojects is 35.0.0;
# Gradle auto-downloads it on first build (licenses are pre-accepted here, so it's
# unattended). To make builds fully offline, add "build-tools;35.0.0" to this list.
RUN yes | sdkmanager --licenses >/dev/null && \
    sdkmanager \
      "platform-tools" \
      "platforms;android-36" \
      "build-tools;36.0.0" \
      "ndk;27.1.12297006" \
      "cmake;3.22.1" >/dev/null

# Gradle caches (wrapper download + build cache) persist in a named volume that
# docker-compose.apk.yml mounts here — so only the first build is slow.
ENV GRADLE_USER_HOME=/opt/gradle-cache

WORKDIR /build
COPY entrypoint.sh /usr/local/bin/build-apk
# Normalize line endings (in case the file was checked out with CRLF on Windows)
# and make it executable.
RUN sed -i 's/\r$//' /usr/local/bin/build-apk && chmod +x /usr/local/bin/build-apk

ENTRYPOINT ["/usr/local/bin/build-apk"]
