#!/bin/bash
#
# Build, tag and push the LTI tool's image (lti.codecogs.com), from exactly the commit
# set_version.sh tagged. Same checks as fxPlugins' own upload-docker.sh.
#
#   ./set_version.sh && ./upload-docker.sh
#
# Needs `docker login --username willzyba` done once on this machine.
set -e
cd "$(dirname "$0")"
TAG=$(cat version)
IMAGE="willzyba/fxeditor-lti"
STACK_FILE="docker-swarm/docker-fxlti.yml"

WANT=$(sed -n -E "s|.*image: ${IMAGE}:(.*)|\1|p" "$STACK_FILE" | tr -d ' \r')
if [ "$WANT" != "$TAG" ]; then
    echo "version says $TAG but $STACK_FILE asks for ${WANT:-nothing}. Run ./set_version.sh."
    exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no -- . "$STACK_FILE")" ]; then
    echo "The repository has uncommitted changes. Commit them first, so v$TAG names something."
    git status --short -- . "$STACK_FILE"
    exit 1
fi
if [ "$(git rev-parse -q --verify "v${TAG}^{commit}")" != "$(git rev-parse HEAD)" ]; then
    echo "v${TAG} is not the current commit. Run ./set_version.sh first."
    exit 1
fi

# linux/amd64: the swarm nodes are x86; a build on Apple Silicon otherwise pushes arm64.
docker buildx build --platform linux/amd64 -t "${IMAGE}:$TAG" .
docker push "${IMAGE}:$TAG"
echo -e "\n *** On codecogs1 (the manager):\n\
    scp docker-swarm/docker-fxlti.yml codecogs1:/root/\n\
    ssh codecogs1 docker stack deploy --with-registry-auth -c /root/docker-fxlti.yml fxlti\n"
