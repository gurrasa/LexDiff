# Cloud worker: watches LexDiffRegistry for CheckRequested and runs the Chainlink CRE workflow
# (CRE CLI simulator, --broadcast) for each request. Deployed as its own Railway service, root dir `cre`.
# The CRE CLI needs glibc >= 2.38 (Debian trixie).
FROM node:22-trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends bash ca-certificates curl gnupg tar unzip \
 && rm -rf /var/lib/apt/lists/*

ENV HOME=/root
RUN curl -fsSL https://bun.sh/install | bash
RUN curl -sSL https://app.chain.link/cre/install.sh | bash
ENV PATH=/root/.bun/bin:/root/.cre/bin:$PATH

WORKDIR /app
COPY . .
# Installs workflow dependencies and the Javy WASM toolchain the CLI uses to compile the workflow.
RUN cd lexdiff-workflow && bun install && bun x cre-setup

CMD ["bash", "worker/start.sh"]
