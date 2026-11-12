#!/bin/bash
#
# Bump the LTI tool's version, stamp it into its stack file, commit just those two and tag the
# commit lti-v<version>. upload-docker.sh releases from that tag and nothing else.
#
#   lti/set_version.sh && lti/upload-docker.sh
#
# The LTI tool is released on its own, separately from the fxplugins site (the repo root's
# set_version.sh, tags v<version>), so it has its own version file, tag prefix and image.
set -e
cd "$(dirname "$0")"
VERSION_FILE="version"
STACK_FILE="../docker-swarm/docker-fxlti.yml"
IMAGE="willzyba/fxeditor-lti"

version=$(awk -F. -v OFS=. 'NF==1{print ++$NF}; NF>1{if(length($NF+1)>length($NF))$(NF-1)++; $NF=sprintf("%0*d", length($NF), ($NF+1)%(10^length($NF))); print}' "$VERSION_FILE")
if git rev-parse -q --verify "refs/tags/lti-v$version" >/dev/null; then
    echo "Tag lti-v$version already exists. $VERSION_FILE says $(cat "$VERSION_FILE")." >&2
    exit 1
fi
echo "$version" > "$VERSION_FILE"
sed -i.bak -E "s|(image: ${IMAGE}:).*|\1${version}|" "$STACK_FILE" && rm -f "$STACK_FILE.bak"

# --only: these two files alone, whatever else in the repo is modified or staged.
git add -- "$VERSION_FILE" "$STACK_FILE"
git commit --quiet --only -m "LTI version $version" -- "$VERSION_FILE" "$STACK_FILE"
git tag -a "lti-v$version" -m "Releasing the LTI tool, version $version"
echo "committed and tagged lti-v$version"
