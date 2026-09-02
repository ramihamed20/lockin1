FROM clamav/clamav:1.5_base-debian13-slim

# clamd's upstream INSTREAM default is 25 MiB. Lock-in's largest production
# upload is 90 MiB, so the scanner must accept the same object end to end.
RUN sed -ri 's|^#?StreamMaxLength[[:space:]].*|StreamMaxLength 100M|' /etc/clamav/clamd.conf \
    && sed -ri 's|^#?MaxFileSize[[:space:]].*|MaxFileSize 100M|' /etc/clamav/clamd.conf \
    && grep -qx 'StreamMaxLength 100M' /etc/clamav/clamd.conf \
    && grep -qx 'MaxFileSize 100M' /etc/clamav/clamd.conf

# The loaded signature set needs roughly 1.6 GiB, and a concurrent reload holds
# two copies at once — briefly about 2.4 GiB. Where 4 GiB is available, leave
# this alone: scanning continues throughout the daily reload.
#
# Set CLAMAV_CONCURRENT_RELOAD=false on a memory-constrained host to halve that
# peak. The trade-off is real: clamd unloads the old database before loading the
# new one, so scans block for the length of the reload. The file-scan worker
# treats that as scanner_unavailable and retries with backoff, and delivery of
# unscanned files stays closed meanwhile.
ARG CLAMAV_CONCURRENT_RELOAD=true
RUN if [ "$CLAMAV_CONCURRENT_RELOAD" = "false" ]; then \
        sed -ri 's|^#?ConcurrentDatabaseReload[[:space:]].*|ConcurrentDatabaseReload no|' \
            /etc/clamav/clamd.conf \
        && grep -qx 'ConcurrentDatabaseReload no' /etc/clamav/clamd.conf; \
    fi
