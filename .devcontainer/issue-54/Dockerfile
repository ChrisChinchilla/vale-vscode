FROM jdkato/vale:latest AS vale
FROM mcr.microsoft.com/devcontainers/base:ubuntu

COPY --from=vale /bin/vale /opt/vale/bin/vale
COPY --from=vale /lib/ld-musl-*.so.1 /lib/
COPY --from=vale /lib/libc.musl-*.so.1 /lib/
COPY --from=vale /usr/lib/libstdc++.so.6 /usr/lib/
COPY --from=vale /usr/lib/libgcc_s.so.1 /usr/lib/
