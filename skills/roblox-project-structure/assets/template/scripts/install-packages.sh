#!/bin/sh
# Install Wally packages and re-export their types so strict Luau can see them.
# Run after cloning and after every change to wally.toml.
set -e
wally install
rojo sourcemap default.project.json --output sourcemap.json
wally-package-types --sourcemap sourcemap.json Packages/
if [ -d ServerPackages ]; then
	wally-package-types --sourcemap sourcemap.json ServerPackages/
fi
