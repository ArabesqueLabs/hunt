# hunt, as a container image. The service listens on :4848 and keeps its
# SQLite database in /data (mount a volume there), unless HUNT_DB names a
# PostgreSQL or MySQL database instead.
#
#   docker build --platform linux/amd64 -t hunt .
#   docker run -p 4848:4848 -v hunt-data:/data hunt

# Dependencies are built in a layer of their own, from cargo-chef's recipe:
# what hunt depends on, with its own version left out. A release (a new
# version) or a code change reuses that layer from the cache; only a change
# of dependencies builds them again.
FROM lukemathwalker/cargo-chef:latest-rust-1-bookworm AS chef
WORKDIR /src

# The recipe: dependencies only.
FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo chef prepare --recipe-path recipe.json

# The dependencies, cached while the recipe stays the same; then hunt.
FROM chef AS build
COPY --from=planner /src/recipe.json recipe.json
RUN cargo chef cook --release --locked --recipe-path recipe.json
COPY Cargo.toml Cargo.lock README.md ./
COPY src ./src
RUN cargo build --release --locked \
    && strip target/release/hunt && mkdir /data

# Distroless: glibc and CA certificates, no shell; runs as uid 65532.
FROM gcr.io/distroless/cc-debian12:nonroot
COPY --from=build /src/target/release/hunt /usr/local/bin/hunt
# hunt's licence, and the bundled fonts' (each under the SIL Open Font License).
COPY LICENSE /usr/share/doc/hunt/
COPY src/web/fonts/README.md src/web/fonts/OFL-*.txt /usr/share/doc/hunt/fonts/
# The data folder, the non-root user's own (a new volume takes its owner).
COPY --from=build --chown=65532:65532 /data /data
ENV HUNT_ADDR=0.0.0.0:4848 \
    HUNT_DB=/data/hunt.db
VOLUME /data
EXPOSE 4848
USER nonroot
ENTRYPOINT ["/usr/local/bin/hunt"]
CMD ["serve"]
