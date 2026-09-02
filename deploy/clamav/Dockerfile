FROM clamav/clamav:1.5_base-debian13-slim

# clamd's upstream INSTREAM default is 25 MiB. Lock-in's largest production
# upload is 90 MiB, so the scanner must accept the same object end to end.
RUN sed -ri 's|^#?StreamMaxLength[[:space:]].*|StreamMaxLength 100M|' /etc/clamav/clamd.conf \
    && sed -ri 's|^#?MaxFileSize[[:space:]].*|MaxFileSize 100M|' /etc/clamav/clamd.conf \
    && grep -qx 'StreamMaxLength 100M' /etc/clamav/clamd.conf \
    && grep -qx 'MaxFileSize 100M' /etc/clamav/clamd.conf
