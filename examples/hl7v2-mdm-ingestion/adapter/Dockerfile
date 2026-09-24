FROM oven/bun:1.3.12
WORKDIR /app
COPY interbox/src/mdm ./interbox/src/mdm
COPY adapter/src ./adapter/src
USER bun
CMD ["bun", "adapter/src/server.ts"]
