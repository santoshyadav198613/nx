#!/usr/bin/env bash
##################################################
# This shell script is executed by nx-release.js #
##################################################

VERSION=$1
TAG=$2
PACKAGE_SOURCE=build/packages
NPM_DEST=build/npm
ORIG_DIRECTORY=`pwd`

# Get rid of tarballs at top of copied directory (made with npm pack)
find $NPM_DEST -maxdepth 1 -name *.tgz -delete

# We are running inside of a child_process, so we need to reauth
npm adduser

cd build/npm/azure
PACKAGE_NAME=`node -e "console.log(require('./package.json').name)"`
echo "Publishing ${PACKAGE_NAME}@${VERSION} --tag ${TAG}"
npm publish --tag $TAG --access public

echo "Publishing complete"
