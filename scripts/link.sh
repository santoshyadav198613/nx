#!/usr/bin/env bash

if [ "$1" = "fast" ]; then
  ./scripts/build_for_test.sh
fi

if [ "$1" != "fast" ]; then
  ./scripts/build.sh
fi

rm -rf node_modules/@nrwl

cp -r build/packages node_modules/@nrwl

for dir in ./tmp/*/
do
    dir=${dir%*/}
    rm -rf $dir/node_modules/@nrwl
    cp -r build/packages $dir/node_modules/@nrwl
done

rm -rf /mnt/c/Users/Victor/projects/products/nx-documentation/node_modules/@nrwl
cp -r build/packages /mnt/c/Users/Victor/projects/products/nx-documentation/node_modules/@nrwl
