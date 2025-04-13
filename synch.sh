#!/bin/bash
yarn run build

target=/static/demo/$([ "$1" == "" ] &&  basename $(realpath $(dirname $0))|| echo $1)

echo "Synch to http://fforw.de/$target"

rsync -rvIz --rsh=ssh --delete --exclude=.git --exclude=*.blend ./docs/ newweb:/var/www/$target
